import { describe, expect, it, vi } from "vitest";

import {
  createRedisClaimStore,
  getRedisReadiness,
  RedisRestClaimStore,
} from "./redis-rest";

describe("Redis claim store readiness", () => {
  it("fails closed unless both REST credentials exist", () => {
    expect(getRedisReadiness({})).toEqual({
      configured: false,
      missing: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    });
  });

  it("requires an HTTPS REST URL", () => {
    expect(() =>
      createRedisClaimStore({
        UPSTASH_REDIS_REST_URL: "http://redis.example",
        UPSTASH_REDIS_REST_TOKEN: "redis-token",
      }),
    ).toThrowError("CLAIM_STORE_UNAVAILABLE");
  });
});

describe("Redis REST atomic commands", () => {
  it("acquires a lock with SET NX EX without leaking the token into the body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ result: "OK" }));
    const store = new RedisRestClaimStore(
      "https://redis.example",
      "secret-redis-token",
      fetchMock,
    );

    await expect(store.setNx("lock-key", "owner", 120)).resolves.toBe(true);

    const request = fetchMock.mock.calls[0];
    const headers = new Headers(request?.[1]?.headers);
    expect(JSON.parse(String(request?.[1]?.body))).toEqual([
      "SET",
      "lock-key",
      "owner",
      "NX",
      "EX",
      120,
    ]);
    expect(headers.get("Authorization")).toBe("Bearer secret-redis-token");
    expect(String(request?.[1]?.body)).not.toContain("secret-redis-token");
  });

  it("reports an existing lock when Redis returns null", async () => {
    const store = new RedisRestClaimStore(
      "https://redis.example",
      "redis-token",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ result: null })),
    );

    await expect(store.setNx("lock-key", "owner", 120)).resolves.toBe(false);
  });

  it("releases a lock through owner-checked Lua only", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ result: 1 }));
    const store = new RedisRestClaimStore(
      "https://redis.example",
      "redis-token",
      fetchMock,
    );

    await expect(store.compareDelete("lock-key", "owner")).resolves.toBe(true);
    const command = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as unknown[];
    expect(command[0]).toBe("EVAL");
    expect(String(command[1])).toContain('redis.call("get", KEYS[1])');
    expect(command.slice(-3)).toEqual([1, "lock-key", "owner"]);
  });

  it("rejects Redis error payloads without returning their details", async () => {
    const store = new RedisRestClaimStore(
      "https://redis.example",
      "redis-token",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ error: "private provider details" })),
    );

    await expect(store.get("key")).rejects.toThrowError(
      "CLAIM_STORE_UNAVAILABLE",
    );
  });
});
