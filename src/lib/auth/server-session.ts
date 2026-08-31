import "server-only";

import { createHash } from "node:crypto";

import {
  createRedisAuthStore,
  type AuthKeyValueStore,
} from "@/lib/idempotency/redis-rest";

import type { AuthConfig } from "./config";
import {
  createRandomToken,
  MAX_SEALED_SERVER_SESSION_BYTES,
  sealPayload,
  unsealPayload,
} from "./crypto";
import { AuthError } from "./errors";
import {
  APP_SESSION_IDLE_TTL_SECONDS,
  createAppSessionPointer,
  type AdminIdentity,
  type AppSession,
  type DomiNationsCredential,
  readAppSessionPointer,
} from "./session";

const SESSION_KEY_PREFIX = "auth:session:v2:";

interface StoredAppSession {
  issuedAt: number;
  expiresAt: number;
  lastSeenAt: number;
  dominationsConnectedAt: number | null;
  admin: AdminIdentity;
  googleRefreshToken: string;
  dominations: DomiNationsCredential | null;
  claimCsrfToken: string;
}

export interface ResolvedAppSession {
  session: AppSession;
  sealedCookie: string;
}

export interface ResolveSessionOptions {
  nowSeconds?: number;
  store?: AuthKeyValueStore;
}

export async function createServerAppSession(
  admin: AdminIdentity,
  googleRefreshToken: string,
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
    dominationsConnectedAt: null,
    admin,
    googleRefreshToken,
    dominations: null,
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

  const stored: StoredAppSession = {
    ...readStoredSession(storedValue, config.sessionSecret, nowSeconds),
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

export async function attachDomiNationsSession(
  sealedCookie: string,
  dominations: DomiNationsCredential,
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

  const stored: StoredAppSession = {
    ...readStoredSession(storedValue, config.sessionSecret, nowSeconds),
    expiresAt: nowSeconds + APP_SESSION_IDLE_TTL_SECONDS,
    lastSeenAt: nowSeconds,
    dominationsConnectedAt: nowSeconds,
    dominations,
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

function isStoredAppSession(value: unknown): value is StoredAppSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const session = value as Partial<StoredAppSession>;
  return (
    typeof session.issuedAt === "number" &&
    typeof session.expiresAt === "number" &&
    typeof session.lastSeenAt === "number" &&
    (session.dominationsConnectedAt === null ||
      typeof session.dominationsConnectedAt === "number") &&
    typeof session.googleRefreshToken === "string" &&
    session.googleRefreshToken.length > 0 &&
    typeof session.claimCsrfToken === "string" &&
    session.claimCsrfToken.length >= 32 &&
    typeof session.admin?.subject === "string" &&
    session.admin.subject.length > 0 &&
    typeof session.admin.email === "string" &&
    typeof session.admin.name === "string" &&
    (session.dominations === null ||
      isDomiNationsCredential(session.dominations))
  );
}

function isDomiNationsCredential(value: unknown): value is DomiNationsCredential {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const credential = value as Partial<DomiNationsCredential>;
  return (
    typeof credential.accessToken === "string" &&
    credential.accessToken.length > 0 &&
    Array.isArray(credential.cookies) &&
    credential.cookies.every((cookie) => typeof cookie === "string") &&
    typeof credential.userId === "string" &&
    typeof credential.xsollaId === "string"
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
