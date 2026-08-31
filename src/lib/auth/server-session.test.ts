import { describe, expect, it } from "vitest";

import type { AuthKeyValueStore } from "@/lib/idempotency/redis-rest";

import type { AuthConfig } from "./config";
import {
  attachDomiNationsSession,
  createServerAppSession,
  destroyServerAppSession,
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
    expect(result.session.dominations).toBeNull();
    expect(store.writes[0]?.ttl).toBe(APP_SESSION_IDLE_TTL_SECONDS);
  });

  it("extends the 180-day idle TTL on normal activity", async () => {
    const store = new MemoryAuthStore();
    const created = await createServerAppSession(
      admin,
      "google-refresh-token",
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

  it("attaches DomiNations credentials without exposing them to the browser", async () => {
    const store = new MemoryAuthStore();
    const created = await createServerAppSession(
      admin,
      "google-refresh-token",
      config,
      store,
      1_000,
    );

    const attached = await attachDomiNationsSession(
      created.sealedCookie,
      dominations,
      config,
      {
        store,
        nowSeconds: 1_100,
      },
    );
    const pointer = readAppSessionPointer(
      attached.sealedCookie,
      config.sessionSecret,
      1_101,
    );
    const storedValue = store.values.get(getAppSessionRedisKey(pointer.sessionId))!;

    expect(attached.session.dominations).toEqual(dominations);
    expect(attached.sealedCookie).not.toContain("raw-dominations-token");
    expect(storedValue).not.toContain("raw-dominations-token");
  });

  it("keeps an attached DomiNations session during normal activity", async () => {
    const store = new MemoryAuthStore();
    const created = await createServerAppSession(
      admin,
      "google-refresh-token",
      config,
      store,
      1_000,
    );
    const attached = await attachDomiNationsSession(
      created.sealedCookie,
      dominations,
      config,
      { store, nowSeconds: 1_010 },
    );

    const resolved = await resolveServerAppSession(attached.sealedCookie, config, {
      store,
      nowSeconds: 1_100,
    });

    expect(resolved.session.dominations).toEqual(dominations);
    expect(resolved.session.admin).toEqual(admin);
  });

  it("removes the Redis record during logout", async () => {
    const store = new MemoryAuthStore();
    const created = await createServerAppSession(
      admin,
      "google-refresh-token",
      config,
      store,
    );

    await destroyServerAppSession(created.sealedCookie, config.sessionSecret, store);
    expect(store.values.size).toBe(0);
    expect(store.deletes).toHaveLength(1);
  });
});
