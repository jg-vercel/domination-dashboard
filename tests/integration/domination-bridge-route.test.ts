// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST as bridgeDomiNationsSession } from "@/app/api/auth/dominations/bridge/route";
import { getAuthConfig } from "@/lib/auth/config";
import { createServerAppSession } from "@/lib/auth/server-session";
import type { AuthKeyValueStore } from "@/lib/idempotency/redis-rest";

const sessionSecret =
  "integration-bridge-session-secret-with-at-least-32-characters";
const xsollaToken = `${"a".repeat(32)}.${"b".repeat(32)}.${"c".repeat(32)}`;

describe("DomiNations official session bridge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects cross-origin requests before reading a session", async () => {
    stubEnvironment();
    const response = await bridgeDomiNationsSession(
      createRequest({ origin: "https://attacker.example" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ORIGIN_REJECTED" },
    });
  });

  it("rejects a mismatched bridge CSRF token", async () => {
    stubEnvironment();
    const { sealedCookie, redisValues } = await createGoogleSession();
    vi.stubGlobal("fetch", createBridgeFetch(redisValues));

    const response = await bridgeDomiNationsSession(
      createRequest({ sealedCookie, csrfToken: "wrong-token", xsollaToken }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CSRF_REJECTED" },
    });
  });

  it.each([0, 1, 2, 3, 4, 6])("exchanges the official token and stores encrypted Domi credentials for %i accounts", async (count) => {
    stubEnvironment();
    const { sealedCookie, csrfToken, redisValues } = await createGoogleSession();
    const ids = Array.from({ length: count }, (_, index) => `account-${index}`);
    const fetchMock = createBridgeFetch(redisValues, ids);
    vi.stubGlobal("fetch", fetchMock);

    const response = await bridgeDomiNationsSession(
      createRequest({ sealedCookie, csrfToken, xsollaToken }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, accountCount: count });
    expect(response.headers.get("set-cookie")).toContain("domi_session=");
    expect(JSON.stringify(body)).not.toContain(xsollaToken);
    expect(response.headers.get("set-cookie")).not.toContain(xsollaToken);
    expect([...redisValues.values()].join("\n")).not.toContain(xsollaToken);
    expect([...redisValues.values()].join("\n")).not.toContain("domi-bearer");

    const signupCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/accounts/signup"),
    );
    expect(signupCall).toBeTruthy();
    expect(JSON.parse(String(signupCall?.[1]?.body))).toMatchObject({
      jwt: xsollaToken,
      password: "",
    });
  });
});

function stubEnvironment() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
  vi.stubEnv("APP_SESSION_SECRET", sessionSecret);
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-secret-token");
}

async function createGoogleSession() {
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
  return {
    sealedCookie: created.sealedCookie,
    csrfToken: created.session.claimCsrfToken,
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

function createBridgeFetch(redisValues: Map<string, string>, ids = ["account-1", "account-2", "account-3"]) {
  return vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://redis.example")) {
      const command = JSON.parse(String(init?.body)) as unknown[];
      const operation = command[0];
      const key = String(command[1] ?? "");
      if (operation === "GET") {
        return Response.json({ result: redisValues.get(key) ?? null });
      }
      if (operation === "SET") {
        redisValues.set(key, String(command[2] ?? ""));
        return Response.json({ result: "OK" });
      }
      return Response.json({ error: "unsupported" }, { status: 400 });
    }

    if (url.endsWith("/api/accounts/signup")) {
      return Response.json(
        { authcode: "domi-auth-code" },
        { headers: { "Set-Cookie": "auth_flow=flow-cookie; Path=/" } },
      );
    }
    if (url.endsWith("/api/accounts/token")) {
      return Response.json({
        token: "domi-bearer",
        userid: "domi-user",
        xsid: "xsolla-user",
      });
    }
    if (url.endsWith("/api/gameident/dom/list")) {
      return Response.json({ gameIds: Object.fromEntries(ids.map((id) => [id, {}])) });
    }
    if (url.endsWith("/api/dominations/linked_user_info")) {
      return Response.json({
        accounts: ids.map((gameAccountId) => ({ gameAccountId, name: gameAccountId })),
      });
    }
    return Response.json({ error: "unexpected upstream" }, { status: 500 });
  });
}

function createRequest({
  origin = "http://localhost:3000",
  sealedCookie,
  csrfToken,
  xsollaToken: token,
}: {
  origin?: string;
  sealedCookie?: string;
  csrfToken?: string;
  xsollaToken?: string;
} = {}) {
  const headers = new Headers({ Origin: origin, "Content-Type": "application/json" });
  if (sealedCookie) headers.set("Cookie", `domi_session=${sealedCookie}`);
  if (csrfToken) headers.set("X-Bridge-CSRF", csrfToken);
  return new NextRequest(
    "http://localhost:3000/api/auth/dominations/bridge",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ xsollaToken: token ?? xsollaToken }),
    },
  );
}
