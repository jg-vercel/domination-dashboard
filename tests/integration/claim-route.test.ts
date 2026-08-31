// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST as claimAll } from "@/app/api/claims/free-legendary-token/route";
import { GET as getClaimAudits } from "@/app/api/claims/audit/route";
import { getAuthConfig } from "@/lib/auth/config";
import {
  attachDomiNationsSession,
  createServerAppSession,
} from "@/lib/auth/server-session";
import type { AuthKeyValueStore } from "@/lib/idempotency/redis-rest";

const sessionSecret =
  "integration-claim-session-secret-with-at-least-32-characters";

describe("claim Route Handler safety boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fails closed before session handling when auth is not configured", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("NODE_ENV", "development");

    const response = await claimAll(createRequest());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CLAIM_NOT_CONFIGURED" },
    });
  });

  it("rejects cross-origin and unauthenticated requests", async () => {
    stubAuthEnvironment();

    const crossOrigin = await claimAll(
      createRequest({ origin: "https://attacker.example" }),
    );
    expect(crossOrigin.status).toBe(403);

    const noSession = await claimAll(createRequest());
    expect(noSession.status).toBe(401);
  });

  it("rejects a mismatched claim CSRF token", async () => {
    stubAuthEnvironment();
    const { sealed, redisValues } = await createTestSession();
    vi.stubGlobal("fetch", createRedisFetch(redisValues));

    const response = await claimAll(
      createRequest({ sealedSession: sealed, csrfToken: "wrong-token" }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CSRF_REJECTED" },
    });
  });

  it("requires the distributed claim store before any DomiNations request", async () => {
    stubAuthEnvironment();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const { sealed, csrfToken } = await createTestSession();

    const response = await claimAll(
      createRequest({ sealedSession: sealed, csrfToken }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CLAIM_STORE_NOT_CONFIGURED" },
    });
  });

  it("returns only parsed safe audit entries for an authenticated session", async () => {
    stubAuthEnvironment();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-secret-token");
    const { sealed, redisValues } = await createTestSession();
    const safeAudit = {
      version: 1,
      cycleId: "2026-08-28",
      executedAt: "2026-08-28T00:01:00.000Z",
      summary: {
        success: 1,
        already_claimed: 0,
        duplicate: 0,
        ineligible: 0,
        failed: 0,
        uncertain: 0,
      },
      results: [
        {
          accountName: "Commander",
          maskedAccountId: "••••0001",
          status: "success",
          reason: "CONFIRMED",
        },
      ],
    };
    const redisFetch = createRedisFetch(redisValues, [
      JSON.stringify(safeAudit),
      "corrupted",
    ]);
    vi.stubGlobal("fetch", redisFetch);

    const response = await getClaimAudits(
      new NextRequest("http://localhost:3000/api/claims/audit", {
        headers: { Cookie: `domi_session=${sealed}` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, audits: [safeAudit] });
    expect(JSON.stringify(body)).not.toContain("dominations-bearer");
    expect(JSON.stringify(body)).not.toContain("redis-secret-token");
  });
});

function stubAuthEnvironment() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
  vi.stubEnv("APP_SESSION_SECRET", sessionSecret);
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-secret-token");
}

async function createTestSession() {
  const store = new MemoryAuthStore();
  const created = await createServerAppSession(
    {
      subject: "google-subject",
      email: "admin@example.com",
      name: "Admin",
    },
    "google-refresh-token",
    getAuthConfig(),
    store,
  );
  const { session, sealedCookie } = await attachDomiNationsSession(
    created.sealedCookie,
    {
      accessToken: "dominations-bearer",
      cookies: ["domi=session"],
      userId: "user-1",
      xsollaId: "xsolla-1",
    },
    getAuthConfig(),
    { store },
  );
  return {
    sealed: sealedCookie,
    csrfToken: session.claimCsrfToken,
    redisValues: new Map(store.values),
  };
}

class MemoryAuthStore implements AuthKeyValueStore {
  readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
  }
}

function createRedisFetch(
  values: Map<string, string>,
  audits: string[] = [],
) {
  return vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
    const command = JSON.parse(String(init?.body)) as unknown[];
    const operation = command[0];
    const key = String(command[1] ?? "");

    if (operation === "GET") {
      return Response.json({ result: values.get(key) ?? null });
    }
    if (operation === "SET") {
      values.set(key, String(command[2] ?? ""));
      return Response.json({ result: "OK" });
    }
    if (operation === "LRANGE") {
      return Response.json({ result: audits });
    }
    if (operation === "DEL") {
      const existed = values.delete(key);
      return Response.json({ result: existed ? 1 : 0 });
    }
    return Response.json({ error: "unsupported test command" }, { status: 400 });
  });
}

function createRequest({
  origin = "http://localhost:3000",
  sealedSession,
  csrfToken,
}: {
  origin?: string;
  sealedSession?: string;
  csrfToken?: string;
} = {}) {
  const headers = new Headers({ Origin: origin });
  if (sealedSession) headers.set("Cookie", `domi_session=${sealedSession}`);
  if (csrfToken) headers.set("X-Claim-CSRF", csrfToken);
  return new NextRequest(
    "http://localhost:3000/api/claims/free-legendary-token",
    { method: "POST", headers },
  );
}
