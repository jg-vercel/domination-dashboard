import { describe, expect, it, vi } from "vitest";

import type { AuthKeyValueStore } from "@/lib/idempotency/redis-rest";

import type { AuthConfig } from "./config";
import { AuthError } from "./errors";
import {
  createServerAppSession,
  destroyServerAppSession,
  DOMINATIONS_RECONNECT_INTERVAL_SECONDS,
  getAppSessionRedisKey,
  resolveServerAppSession,
} from "./server-session";
import {
  APP_SESSION_IDLE_TTL_SECONDS,
  readAppSessionPointer,
} from "./session";

const config: AuthConfig = {
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  sessionSecret: "server-session-secret-with-at-least-32-characters",
  baseUrl: "http://localhost:3000",
  secureCookies: false,
};

const admin = {
  subject: "google-subject",
  email: "user@example.com",
  name: "User",
};

const dominations = {
  accessToken: "raw-dominations-token",
  cookies: ["domi_session=raw-cookie"],
  userId: "user-1",
  xsollaId: "xsolla-1",
};

class MemoryAuthStore implements AuthKeyValueStore {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; ttl: number; value: string }> = [];
  readonly deletes: string[] = [];

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number) {
    this.values.set(key, value);
    this.writes.push({ key, ttl: ttlSeconds, value });
  }

  async delete(key: string) {
    this.values.delete(key);
    this.deletes.push(key);
  }
}

describe("server-side app sessions", () => {
  it("stores upstream credentials only in an encrypted Redis value", async () => {
    const store = new MemoryAuthStore();
    const result = await createServerAppSession(
      admin,
      "raw-google-refresh-token",
      dominations,
      config,
      store,
      1_000,
    );
    const pointer = readAppSessionPointer(
      result.sealedCookie,
      config.sessionSecret,
      1_001,
    );
    const key = getAppSessionRedisKey(pointer.sessionId);
    const storedValue = store.values.get(key)!;

    expect(key).not.toContain(pointer.sessionId);
    expect(result.sealedCookie).not.toContain(admin.email);
    expect(result.sealedCookie).not.toContain("raw-google-refresh-token");
    expect(result.sealedCookie).not.toContain("raw-dominations-token");
    expect(storedValue).not.toContain("raw-google-refresh-token");
    expect(storedValue).not.toContain("raw-dominations-token");
    expect(store.writes[0]?.ttl).toBe(APP_SESSION_IDLE_TTL_SECONDS);
  });

  it("extends the 180-day idle TTL on normal activity", async () => {
    const store = new MemoryAuthStore();
    const created = await createServerAppSession(
      admin,
      "google-refresh-token",
      dominations,
      config,
      store,
      1_000,
    );

    const resolved = await resolveServerAppSession(created.sealedCookie, config, {
      store,
      nowSeconds: 1_100,
    });

    expect(resolved.session.expiresAt).toBe(
      1_100 + APP_SESSION_IDLE_TTL_SECONDS,
    );
    expect(store.writes.at(-1)?.ttl).toBe(APP_SESSION_IDLE_TTL_SECONDS);
  });

  it("refreshes Google and reconnects DomiNations when the credential is due", async () => {
    const store = new MemoryAuthStore();
    const created = await createServerAppSession(
      admin,
      "google-refresh-token",
      dominations,
      config,
      store,
      1_000,
    );
    const refresh = vi.fn().mockResolvedValue("renewed-google-access-token");
    const reconnect = vi.fn().mockResolvedValue({
      ...dominations,
      accessToken: "renewed-dominations-token",
    });
    const validate = vi.fn().mockResolvedValue({ accountCount: 3 });

    const resolved = await resolveServerAppSession(created.sealedCookie, config, {
      store,
      nowSeconds: 1_000 + DOMINATIONS_RECONNECT_INTERVAL_SECONDS,
      refreshAccessToken: refresh,
      connectDomi: reconnect,
      validateAccounts: validate,
    });

    expect(refresh).toHaveBeenCalledWith(config, "google-refresh-token");
    expect(reconnect).toHaveBeenCalledWith("renewed-google-access-token");
    expect(validate).toHaveBeenCalledOnce();
    expect(resolved.session.dominations.accessToken).toBe(
      "renewed-dominations-token",
    );
  });

  it("deletes the server session when Google revokes the refresh token", async () => {
    const store = new MemoryAuthStore();
    const created = await createServerAppSession(
      admin,
      "revoked-refresh-token",
      dominations,
      config,
      store,
      1_000,
    );

    await expect(
      resolveServerAppSession(created.sealedCookie, config, {
        store,
        nowSeconds: 1_100,
        forceReconnect: true,
        refreshAccessToken: vi
          .fn()
          .mockRejectedValue(new AuthError("GOOGLE_REFRESH_REJECTED")),
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_REFRESH_REJECTED" });
    expect(store.values.size).toBe(0);
    expect(store.deletes).toHaveLength(1);
  });

  it("removes the Redis record during logout", async () => {
    const store = new MemoryAuthStore();
    const created = await createServerAppSession(
      admin,
      "google-refresh-token",
      dominations,
      config,
      store,
    );

    await destroyServerAppSession(created.sealedCookie, config.sessionSecret, store);
    expect(store.values.size).toBe(0);
    expect(store.deletes).toHaveLength(1);
  });
});
