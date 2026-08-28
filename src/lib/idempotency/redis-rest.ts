import "server-only";

import { AuthError } from "@/lib/auth/errors";

const REDIS_TIMEOUT_MS = 5_000;
const RELEASE_LOCK_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export interface RedisEnvironment {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

export interface ClaimStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  setNx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  compareDelete(key: string, owner: string): Promise<boolean>;
}

export interface RedisReadiness {
  configured: boolean;
  missing: string[];
}

export class RedisStoreError extends Error {
  constructor(options?: ErrorOptions) {
    super("CLAIM_STORE_UNAVAILABLE", options);
    this.name = "RedisStoreError";
  }
}

export function getRedisReadiness(
  environment: RedisEnvironment = readRedisEnvironment(),
): RedisReadiness {
  const missing: string[] = [];
  if (!environment.UPSTASH_REDIS_REST_URL?.trim()) {
    missing.push("UPSTASH_REDIS_REST_URL");
  }
  if (!environment.UPSTASH_REDIS_REST_TOKEN?.trim()) {
    missing.push("UPSTASH_REDIS_REST_TOKEN");
  }
  return { configured: missing.length === 0, missing };
}

export function createRedisClaimStore(
  environment: RedisEnvironment = readRedisEnvironment(),
  fetchImplementation: typeof fetch = fetch,
): ClaimStore {
  if (!getRedisReadiness(environment).configured) {
    throw new AuthError("AUTH_NOT_CONFIGURED");
  }

  let url: URL;
  try {
    url = new URL(environment.UPSTASH_REDIS_REST_URL!.trim());
  } catch (error) {
    throw new RedisStoreError({ cause: error });
  }
  if (url.protocol !== "https:") {
    throw new RedisStoreError();
  }

  return new RedisRestClaimStore(
    url.origin,
    environment.UPSTASH_REDIS_REST_TOKEN!.trim(),
    fetchImplementation,
  );
}

export class RedisRestClaimStore implements ClaimStore {
  constructor(
    private readonly restUrl: string,
    private readonly token: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async get(key: string): Promise<string | null> {
    const result = await this.command<unknown>(["GET", key]);
    return typeof result === "string" ? result : null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const result = await this.command<unknown>([
      "SET",
      key,
      value,
      "EX",
      normalizeTtl(ttlSeconds),
    ]);
    if (result !== "OK") {
      throw new RedisStoreError();
    }
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.command<unknown>([
      "SET",
      key,
      value,
      "NX",
      "EX",
      normalizeTtl(ttlSeconds),
    ]);
    return result === "OK";
  }

  async compareDelete(key: string, owner: string): Promise<boolean> {
    const result = await this.command<unknown>([
      "EVAL",
      RELEASE_LOCK_SCRIPT,
      1,
      key,
      owner,
    ]);
    return result === 1;
  }

  private async command<T>(command: Array<string | number>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REDIS_TIMEOUT_MS);

    try {
      const response = await this.fetchImplementation(this.restUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "User-Agent": "domination-dashboard/0.1",
        },
        body: JSON.stringify(command),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new RedisStoreError();
      }

      const payload: unknown = await response.json();
      if (
        typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload) ||
        "error" in payload ||
        !("result" in payload)
      ) {
        throw new RedisStoreError();
      }
      return (payload as { result: T }).result;
    } catch (error) {
      if (error instanceof RedisStoreError) {
        throw error;
      }
      throw new RedisStoreError({ cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeTtl(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1) {
    throw new RedisStoreError();
  }
  return Math.ceil(ttlSeconds);
}

function readRedisEnvironment(): RedisEnvironment {
  return {
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}
