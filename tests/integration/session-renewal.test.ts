// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/auth/session/route";
import { AuthError } from "@/lib/auth/errors";
import { resolveServerAppSession } from "@/lib/auth/server-session";
import { RedisStoreError } from "@/lib/idempotency/redis-rest";

vi.mock("@/lib/auth/server-session", () => ({ resolveServerAppSession: vi.fn() }));
const resolveSession = vi.mocked(resolveServerAppSession);

function request() {
  return new NextRequest("https://dashboard.example/api/auth/session", {
    method: "POST",
    headers: { origin: "https://dashboard.example", cookie: "domi_session=existing-session" },
  });
}

describe("session renewal cookies", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("APP_SESSION_SECRET", "session-secret-with-at-least-32-characters");
    vi.stubEnv("APP_BASE_URL", "https://dashboard.example");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-token");
    resolveSession.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("renews the persistent HttpOnly cookie without returning tokens", async () => {
    resolveSession.mockResolvedValue({
      sealedCookie: "renewed-opaque-session",
      session: {
        issuedAt: 1, expiresAt: 2,
        admin: { subject: "subject", email: "user@example.com", name: "User" },
        dominations: null, claimCsrfToken: "private-csrf",
      },
    });
    const response = await POST(request());
    expect(response.status).toBe(204);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("domi_session=renewed-opaque-session");
    expect(cookie).toContain("Max-Age=34560000");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(cookie).not.toContain("user@example.com");
  });

  it.each(["SESSION_EXPIRED", "SESSION_INVALID"] as const)("clears a confirmed %s cookie", async (code) => {
    resolveSession.mockRejectedValue(new AuthError(code));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
    expect(await response.json()).toEqual({ ok: false, error: { code: "AUTH_REQUIRED" } });
  });

  it.each([
    [new RedisStoreError(), 503],
    [new AuthError("UPSTREAM_UNAVAILABLE"), 502],
  ])("preserves the cookie when resolution temporarily fails", async (error, status) => {
    resolveSession.mockRejectedValue(error);
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("preserves the cookie when deployment configuration is missing", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(resolveSession).not.toHaveBeenCalled();
  });
});
