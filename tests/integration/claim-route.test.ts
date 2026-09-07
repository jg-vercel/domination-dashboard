// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

import { POST as claimAll } from "@/app/api/claims/free-legendary-token/route";
import { GET as getClaimAudits } from "@/app/api/claims/audit/route";
import { getAuthConfig } from "@/lib/auth/config";
import {
  attachDomiNationsSession,
  createServerAppSession,
} from "@/lib/auth/server-session";
import type { AuthKeyValueStore } from "@/lib/idempotency/redis-rest";
import type { BatchClaimResult } from "@/lib/claims/service";
import type { ClaimAuditEntry } from "@/lib/claims/audit";
import { getClaimCycle } from "@/lib/claims/cycle";

const sessionSecret =
  "integration-claim-session-secret-with-at-least-32-characters";

describe("claim Route Handler safety boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("uses one authenticated POST to recover legacy accounts with paced 429 retries through the real service and Redis adapter", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T02:00:00.000Z"));
    vi.spyOn(console, "info").mockImplementation(() => {});
    stubAuthEnvironment();
    const { sealed, csrfToken, redisValues } = await createTestSession();
    const accountIds = ["game-account-0001", "game-account-0002", "game-account-0003", "game-account-0004"];
    const cycle = getClaimCycle();
    const ledgerKeys = accountIds.map((id) => {
      const hash = createHash("sha256").update(`google-subject:${id}:Free Legendary Token`).digest("hex").slice(0, 24);
      return `domi:claim:ledger:${cycle.id}:${hash}`;
    });
    const previousRecords = accountIds.map((_, index) => JSON.stringify({
      status: index === 0 ? "success" : "uncertain",
      reason: index === 0 ? "CONFIRMED" : "POST_PURCHASE_UNCONFIRMED",
      recordedAt: "2026-09-07T01:00:00.000Z",
    }));
    ledgerKeys.forEach((key, index) => redisValues.set(key, previousRecords[index]!));

    const redisFetch = createRedisFetch(redisValues);
    const purchaseAccounts: string[] = [];
    const purchaseTimes: number[] = [];
    const catalogAccounts: string[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.origin === "https://redis.example") return redisFetch(input, init);
      if (url.origin !== "https://api.dominationsworld.com") throw new Error("Unexpected test upstream");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer dominations-bearer");
      expect(new Headers(init?.headers).get("cookie")).toBe("domi=session");
      if (url.pathname === "/api/gameident/dom/list") {
        return Response.json({ gameIds: Object.fromEntries(accountIds.map((id) => [id, {}])) });
      }
      if (url.pathname === "/api/dominations/linked_user_info") {
        return Response.json({ accounts: accountIds.map((gameAccountId, index) => ({ gameAccountId, name: `Commander ${index + 1}` })) });
      }
      const body = JSON.parse(String(init?.body)) as { gameAccountId: string; itemSku?: string; offerId?: string; quantity?: number };
      if (url.pathname === "/api/xsollastore/getproducts") {
        catalogAccounts.push(body.gameAccountId);
        return Response.json(JSON.stringify([{
          name: "Free Legendary Token!", google: "free-token-sku", offerId: "", price: 0,
          is_free: false, stockAvailable: 1, stockMax: 1, tags: ["AdditionalSpecials"],
        }]));
      }
      if (url.pathname === "/api/xsollastore/startpurchase") {
        expect(body).toMatchObject({ itemSku: "free-token-sku", offerId: "", quantity: 1 });
        purchaseAccounts.push(body.gameAccountId);
        purchaseTimes.push(Date.now());
        if (body.gameAccountId === accountIds[2] && purchaseAccounts.filter((id) => id === accountIds[2]).length === 1) {
          return new Response("rate limited", { status: 429, headers: { "Retry-After": "12" } });
        }
        return Response.json({ success: true, orderAccessToken: "free" });
      }
      throw new Error("Unexpected test endpoint");
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstPending = claimAll(createRequest({ sealedSession: sealed, csrfToken }));
    await vi.advanceTimersByTimeAsync(120_000);
    const firstResponse = await firstPending;
    const firstBody = await firstResponse.json() as BatchClaimResult & { ok: boolean };

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("cache-control")).toBe("no-store");
    expect(firstResponse.cookies.get("domi_session")?.value).toBeTruthy();
    expect(firstBody).toMatchObject({ ok: true, auditRecorded: true, summary: { success: 4, uncertain: 0, failed: 0 } });
    expect(firstBody.results[0]).toMatchObject({ status: "success", reason: "CONFIRMED", replayed: true });
    expect(firstBody.results.slice(1)).toEqual(accountIds.slice(1).map(() => expect.objectContaining({
      status: "success", reason: "FREE_PURCHASE_ACCEPTED", recovered: true,
    })));
    const expectedAttempts = [accountIds[1], accountIds[2], accountIds[2], accountIds[3]];
    expect(purchaseAccounts).toEqual(expectedAttempts);
    expect(purchaseTimes.slice(1).map((time, index) => time - purchaseTimes[index]!)).toEqual([5_000, 12_000, 5_000]);
    // Only a rate-limit retry refreshes the catalog; free acknowledgements do not need a receipt poll.
    expect(catalogAccounts).toEqual(expectedAttempts);
    expect(redisValues.get(ledgerKeys[0]!)).toBe(previousRecords[0]);
    for (let index = 1; index < ledgerKeys.length; index += 1) {
      expect(JSON.parse(redisValues.get(ledgerKeys[index]!)!)).toMatchObject({
        version: 2, status: "success", reason: "FREE_PURCHASE_ACCEPTED", recovered: true,
      });
      const recoveryKey = ledgerKeys[index]!.replace(":ledger:", ":recovery:");
      expect(JSON.parse(redisValues.get(recoveryKey)!)).toMatchObject({ previousRecord: previousRecords[index] });
    }
    expect([...redisValues.keys()].some((key) => key.includes(":account:") || key.includes(":batch:"))).toBe(false);

    const secondResponse = await claimAll(createRequest({ sealedSession: sealed, csrfToken }));
    const secondBody = await secondResponse.json() as BatchClaimResult & { ok: boolean };

    expect(secondResponse.status).toBe(200);
    expect(secondBody.summary.success).toBe(4);
    expect(secondBody.results.every((result) => result.replayed === true)).toBe(true);
    expect(secondBody.results.slice(1).every((result) => result.recovered === true)).toBe(true);
    expect(purchaseAccounts).toEqual(expectedAttempts);
    expect(catalogAccounts).toEqual(expectedAttempts);

    const auditResponse = await getClaimAudits(new NextRequest("http://localhost:3000/api/claims/audit", {
      headers: { Cookie: `domi_session=${sealed}` },
    }));
    const auditBody = await auditResponse.json() as { ok: boolean; audits: ClaimAuditEntry[] };
    expect(auditResponse.status).toBe(200);
    expect(auditBody.ok).toBe(true);
    expect(auditBody.audits).toHaveLength(2);
    for (const entry of auditBody.audits) {
      expect(entry.results.slice(1).every((result) => result.recovered === true && result.reason === "FREE_PURCHASE_ACCEPTED")).toBe(true);
    }
    expect(JSON.stringify({ firstBody, secondBody, auditBody })).not.toMatch(/dominations-bearer|google-refresh-token|redis-secret-token/);
    expect(redisFetch.mock.calls.some(([, init]) => JSON.parse(String(init?.body))[0] === "EVAL")).toBe(true);
    expect(redisFetch.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/pipeline")).toHaveLength(2);
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
  const lists = new Map<string, string[]>();
  return vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://redis.example") throw new Error("Unexpected Redis test origin");
    const command = JSON.parse(String(init?.body)) as unknown[];
    if (url.pathname === "/pipeline") {
      const results = (command as unknown[][]).map(([operation, keyValue, value, stop]) => {
        const key = String(keyValue);
        if (operation === "LPUSH") {
          const next = [String(value), ...(lists.get(key) ?? [])];
          lists.set(key, next);
          return { result: next.length };
        }
        if (operation === "LTRIM") {
          lists.set(key, (lists.get(key) ?? []).slice(Number(value), Number(stop) + 1));
          return { result: "OK" };
        }
        if (operation === "EXPIRE") return { result: 1 };
        throw new Error("Unsupported test pipeline command");
      });
      return Response.json(results);
    }
    const operation = command[0];
    const key = String(command[1] ?? "");

    if (operation === "GET") {
      return Response.json({ result: values.get(key) ?? null });
    }
    if (operation === "SET") {
      if (command.includes("NX") && values.has(key)) return Response.json({ result: null });
      values.set(key, String(command[2] ?? ""));
      return Response.json({ result: "OK" });
    }
    if (operation === "LRANGE") {
      const stop = Number(command[3]);
      return Response.json({ result: (lists.get(key) ?? audits).slice(Number(command[2]), stop < 0 ? undefined : stop + 1) });
    }
    if (operation === "EVAL") {
      const lockKey = String(command[3]);
      const owner = String(command[4]);
      if (values.get(lockKey) !== owner) return Response.json({ result: 0 });
      values.delete(lockKey);
      return Response.json({ result: 1 });
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
