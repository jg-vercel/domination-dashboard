import "server-only";

import { createHash } from "node:crypto";

import { loadAccountDirectory } from "@/lib/dashboard/snapshot";
import {
  createRedisAuthStore,
  type AuthKeyValueStore,
} from "@/lib/idempotency/redis-rest";
import { connectDomiNations } from "@/lib/dominations/client";

import type { AuthConfig } from "./config";
import {
  createRandomToken,
  MAX_SEALED_SERVER_SESSION_BYTES,
  sealPayload,
  unsealPayload,
} from "./crypto";
import { AuthError } from "./errors";
import { refreshGoogleAccessToken } from "./google";
import {
  APP_SESSION_IDLE_TTL_SECONDS,
  createAppSessionPointer,
  type AdminIdentity,
  type AppSession,
  type DomiNationsCredential,
  readAppSessionPointer,
} from "./session";

export const DOMINATIONS_RECONNECT_INTERVAL_SECONDS = 6 * 60 * 60;
const SESSION_KEY_PREFIX = "auth:session:v1:";

interface StoredAppSession {
  issuedAt: number;
  expiresAt: number;
  lastSeenAt: number;
  dominationsConnectedAt: number;
  admin: AdminIdentity;
  googleRefreshToken: string;
  dominations: DomiNationsCredential;
  claimCsrfToken: string;
}

export interface ResolvedAppSession {
  session: AppSession;
  sealedCookie: string;
}

export interface ResolveSessionOptions {
  forceReconnect?: boolean;
  skipReconnect?: boolean;
  nowSeconds?: number;
  store?: AuthKeyValueStore;
  refreshAccessToken?: (
    config: AuthConfig,
    refreshToken: string,
  ) => Promise<string>;
  connectDomi?: (googleAccessToken: string) => Promise<DomiNationsCredential>;
  validateAccounts?: (credentials: DomiNationsCredential) => Promise<unknown>;
}

export async function createServerAppSession(
  admin: AdminIdentity,
  googleRefreshToken: string,
  dominations: DomiNationsCredential,
  config: AuthConfig,
  store: AuthKeyValueStore = createRedisAuthStore(),
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<ResolvedAppSession> {
  if (!googleRefreshToken) {
    throw new AuthError("GOOGLE_REFRESH_TOKEN_MISSING");
  }

  const sessionId = createRandomToken();
  const stored: StoredAppSession = {
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + APP_SESSION_IDLE_TTL_SECONDS,
    lastSeenAt: nowSeconds,
    dominationsConnectedAt: nowSeconds,
    admin,
    googleRefreshToken,
    dominations,
    claimCsrfToken: createRandomToken(),
  };

  await writeStoredSession(sessionId, stored, config.sessionSecret, store);
  return toResolvedSession(sessionId, stored, config.sessionSecret, nowSeconds);
}

export async function resolveServerAppSession(
  sealedCookie: string,
  config: AuthConfig,
  options: ResolveSessionOptions = {},
): Promise<ResolvedAppSession> {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const store = options.store ?? createRedisAuthStore();
  const pointer = readAppSessionPointer(
    sealedCookie,
    config.sessionSecret,
    nowSeconds,
  );
  const storedValue = await store.get(getAppSessionRedisKey(pointer.sessionId));
  if (!storedValue) {
    throw new AuthError("SESSION_EXPIRED");
  }

  let stored = readStoredSession(storedValue, config.sessionSecret, nowSeconds);
  const reconnectDue =
    options.skipReconnect !== true &&
    (options.forceReconnect === true ||
      nowSeconds - stored.dominationsConnectedAt >=
        DOMINATIONS_RECONNECT_INTERVAL_SECONDS);

  if (reconnectDue) {
    const refresh =
      options.refreshAccessToken ??
      ((authConfig: AuthConfig, refreshToken: string) =>
        refreshGoogleAccessToken(authConfig, refreshToken));
    const connect = options.connectDomi ?? connectDomiNations;
    const validate = options.validateAccounts ?? loadAccountDirectory;

    let accessToken: string;
    try {
      accessToken = await refresh(config, stored.googleRefreshToken);
    } catch (error) {
      if (
        error instanceof AuthError &&
        (error.code === "GOOGLE_REFRESH_REJECTED" ||
          error.code === "GOOGLE_REFRESH_TOKEN_MISSING")
      ) {
        await store.delete(getAppSessionRedisKey(pointer.sessionId)).catch(() => {});
      }
      throw error;
    }

    const dominations = await connect(accessToken);
    await validate(dominations);
    stored = {
      ...stored,
      dominations,
      dominationsConnectedAt: nowSeconds,
    };
  }

  stored = {
    ...stored,
    expiresAt: nowSeconds + APP_SESSION_IDLE_TTL_SECONDS,
    lastSeenAt: nowSeconds,
  };
  await writeStoredSession(pointer.sessionId, stored, config.sessionSecret, store);
  return toResolvedSession(
    pointer.sessionId,
    stored,
    config.sessionSecret,
    nowSeconds,
  );
}

export async function destroyServerAppSession(
  sealedCookie: string | undefined,
  secret: string,
  store: AuthKeyValueStore = createRedisAuthStore(),
): Promise<void> {
  if (!sealedCookie) return;

  try {
    const pointer = readAppSessionPointer(sealedCookie, secret);
    await store.delete(getAppSessionRedisKey(pointer.sessionId));
  } catch (error) {
    if (
      error instanceof AuthError &&
      (error.code === "SESSION_EXPIRED" || error.code === "SESSION_INVALID")
    ) {
      return;
    }
    throw error;
  }
}

export function getAppSessionRedisKey(sessionId: string): string {
  const digest = createHash("sha256").update(sessionId, "utf8").digest("hex");
  return `${SESSION_KEY_PREFIX}${digest}`;
}

async function writeStoredSession(
  sessionId: string,
  stored: StoredAppSession,
  secret: string,
  store: AuthKeyValueStore,
): Promise<void> {
  const sealed = sealPayload(
    stored,
    secret,
    MAX_SEALED_SERVER_SESSION_BYTES,
  );
  await store.set(
    getAppSessionRedisKey(sessionId),
    sealed,
    APP_SESSION_IDLE_TTL_SECONDS,
  );
}

function readStoredSession(
  sealed: string,
  secret: string,
  nowSeconds: number,
): StoredAppSession {
  const stored = unsealPayload<StoredAppSession>(sealed, secret, nowSeconds);
  if (!isStoredAppSession(stored)) {
    throw new AuthError("SESSION_INVALID");
  }
  return stored;
}

function isStoredAppSession(value: StoredAppSession): boolean {
  return (
    typeof value.lastSeenAt === "number" &&
    typeof value.dominationsConnectedAt === "number" &&
    typeof value.googleRefreshToken === "string" &&
    value.googleRefreshToken.length > 0 &&
    typeof value.claimCsrfToken === "string" &&
    value.claimCsrfToken.length >= 32 &&
    typeof value.admin?.subject === "string" &&
    value.admin.subject.length > 0 &&
    typeof value.admin.email === "string" &&
    typeof value.admin.name === "string" &&
    typeof value.dominations?.accessToken === "string" &&
    value.dominations.accessToken.length > 0 &&
    Array.isArray(value.dominations.cookies) &&
    value.dominations.cookies.every((cookie) => typeof cookie === "string") &&
    typeof value.dominations.userId === "string" &&
    typeof value.dominations.xsollaId === "string"
  );
}

function toResolvedSession(
  sessionId: string,
  stored: StoredAppSession,
  secret: string,
  nowSeconds: number,
): ResolvedAppSession {
  const { sealed } = createAppSessionPointer(sessionId, secret, nowSeconds);
  return {
    sealedCookie: sealed,
    session: {
      issuedAt: stored.issuedAt,
      expiresAt: stored.expiresAt,
      admin: stored.admin,
      dominations: stored.dominations,
      claimCsrfToken: stored.claimCsrfToken,
    },
  };
}
