// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as connectGoogleAccount } from "@/app/api/auth/dominations/connect/route";
import { getAuthConfig } from "@/lib/auth/config";
import {
  attachDomiNationsSession,
  createServerAppSession,
  resolveServerAppSession,
} from "@/lib/auth/server-session";
import type { DomiNationsCredential } from "@/lib/auth/session";
import type { AuthKeyValueStore } from "@/lib/idempotency/redis-rest";

const sessionSecret = "integration-direct-connect-secret-with-at-least-32-characters";
const googleRefreshToken = "stored-google-refresh-token";
const googleAccessToken = "refreshed-google-access-token";
const xsollaToken = "exchanged-xsolla-token";
const domiAccessToken = "new-domi-access-token";
const accountIds = ["account-1", "account-2", "account-3"];
const previousCredentials: DomiNationsCredential = {
  accessToken: "previous-good-domi-access-token",
  cookies: ["domi_session=previous-cookie"],
  userId: "previous-domi-user",
  xsollaId: "previous-xsolla-user",
};

describe("direct Google-to-DomiNations connection Route Handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requires a dashboard session before contacting Google or the store", async () => {
    stubEnvironment();
    const fetchMock = createConnectFetch(new Map());
    vi.stubGlobal("fetch", fetchMock);

    const response = await connectGoogleAccount(createRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: "AUTH_REQUIRED" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before accessing the stored session", async () => {
    stubEnvironment();
    const session = await createGoogleSession();
    const fetchMock = createConnectFetch(session.store.values);
    vi.stubGlobal("fetch", fetchMock);

    const response = await connectGoogleAccount(
      createRequest({ ...session, origin: "https://attacker.example" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ORIGIN_REJECTED" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, "incorrect-token"])(
    "rejects a missing or incorrect CSRF token (%s) before upstream authentication",
    async (csrfToken) => {
      stubEnvironment();
      const session = await createGoogleSession();
      const fetchMock = createConnectFetch(session.store.values);
      vi.stubGlobal("fetch", fetchMock);

      const response = await connectGoogleAccount(
        createRequest({ ...session, csrfToken }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "CSRF_REJECTED" },
      });
      expect(upstreamCalls(fetchMock)).toEqual([]);
      const resolved = await readSession(session);
      expect(resolved.session.dominations).toBeNull();
    },
  );

  it("refreshes the stored Google login, validates three game accounts, and saves encrypted Domi credentials", async () => {
    stubEnvironment();
    const session = await createGoogleSession();
    const fetchMock = createConnectFetch(session.store.values);
    vi.stubGlobal("fetch", fetchMock);

    const response = await connectGoogleAccount(createRequest(session));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, accountCount: 3 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("domi_session=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");

    const calls = upstreamCalls(fetchMock);
    expect(calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/token",
      "/api/social/google/login_with_token",
      "/api/accounts/signup",
      "/api/accounts/token",
      "/api/gameident/dom/list",
      "/api/dominations/linked_user_info",
    ]);
    const googleBody = new URLSearchParams(String(calls[0]?.[1]?.body));
    expect(googleBody.get("grant_type")).toBe("refresh_token");
    expect(googleBody.get("refresh_token")).toBe(googleRefreshToken);
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({
      access_token: googleAccessToken,
    });
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toMatchObject({ jwt: xsollaToken });
    for (const [, init] of calls.slice(4)) {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${domiAccessToken}`);
      expect(new Headers(init?.headers).get("cookie")).toContain("auth_flow=flow-cookie");
    }

    const resolved = await readSession(session);
    expect(resolved.session.admin.email).toBe("admin@example.com");
    expect(resolved.session.dominations).toEqual({
      accessToken: domiAccessToken,
      cookies: ["auth_flow=flow-cookie", "domi_auth=auth-cookie"],
      userId: "domi-user",
      xsollaId: "xsolla-user",
    });
    const publicAndStoredValues = [
      JSON.stringify(body),
      response.headers.get("set-cookie") ?? "",
      ...session.store.values.values(),
    ].join("\n");
    for (const secret of [googleRefreshToken, googleAccessToken, xsollaToken, domiAccessToken]) {
      expect(publicAndStoredValues).not.toContain(secret);
    }
    // Connecting may authenticate and read account metadata, but must never claim a product.
    expect(calls).toHaveLength(6);
  });

  it.each([
    { linkedIds: accountIds.slice(0, 2), listedIds: accountIds },
    { linkedIds: accountIds, listedIds: ["account-1", "account-2", "different-account"] },
  ])("preserves prior credentials when the three-account validation fails: %j", async (directory) => {
    stubEnvironment();
    const session = await createGoogleSession(previousCredentials);
    const fetchMock = createConnectFetch(session.store.values, directory);
    vi.stubGlobal("fetch", fetchMock);

    const response = await connectGoogleAccount(createRequest(session));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: "ACCOUNT_COUNT_MISMATCH" },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    const resolved = await readSession(session);
    expect(resolved.session.dominations).toEqual(previousCredentials);
    expect(resolved.session.admin.email).toBe("admin@example.com");
    expect(upstreamCalls(fetchMock)).toHaveLength(6);
  });

  it("preserves the dashboard session after Google refresh rejection so the user can sign in again", async () => {
    stubEnvironment();
    const session = await createGoogleSession(previousCredentials);
    const fetchMock = createConnectFetch(session.store.values, { googleStatus: 400 });
    vi.stubGlobal("fetch", fetchMock);

    const response = await connectGoogleAccount(createRequest(session));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: "GOOGLE_REFRESH_REJECTED" },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    const resolved = await readSession(session);
    expect(resolved.session.admin.email).toBe("admin@example.com");
    expect(resolved.session.dominations).toEqual(previousCredentials);
    expect(upstreamCalls(fetchMock).map(([input]) => String(input))).toEqual([
      "https://oauth2.googleapis.com/token",
    ]);
  });

  describe.each([
    { stage: "game_account_list", path: "/api/gameident/dom/list" },
    { stage: "linked_accounts", path: "/api/dominations/linked_user_info" },
  ])("$stage failure reporting", ({ stage, path }) => {
    it.each([
      { kind: "network", status: undefined, responseStatus: 502, code: "UPSTREAM_UNAVAILABLE", reason: "network" },
      { kind: "http", status: 503, responseStatus: 502, code: "UPSTREAM_UNAVAILABLE", reason: "http" },
      { kind: "shape", status: 200, responseStatus: 502, code: "UPSTREAM_UNAVAILABLE", reason: "response_shape" },
      { kind: "session", status: 401, responseStatus: 401, code: "DOMINATIONS_SESSION_REQUIRED", reason: "http" },
    ])("returns a safe stage for $kind failure and preserves the Google session", async ({ kind, status, responseStatus, code, reason }) => {
      stubEnvironment();
      const session = await createGoogleSession(previousCredentials);
      const privateFailure = "private-upstream-body-network-error-or-token";
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchMock = createConnectFetch(session.store.values, {
        accountResponse: {
          path,
          respond: () => {
            if (kind === "network") throw new TypeError(privateFailure);
            return Response.json({ error: privateFailure, access_token: domiAccessToken }, { status });
          },
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      const response = await connectGoogleAccount(createRequest(session));
      const body: unknown = await response.json();

      expect(response.status).toBe(responseStatus);
      expect(body).toEqual({ ok: false, error: { code, stage } });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(warning).toHaveBeenCalledWith("Store connection failed", {
        code: kind === "session" ? "SESSION_EXPIRED" : code,
        stage,
        ...(status === undefined ? {} : { status }),
        reason,
      });
      const visibleDiagnostics = JSON.stringify({ body, warnings: warning.mock.calls });
      for (const secret of [privateFailure, googleRefreshToken, googleAccessToken, xsollaToken, domiAccessToken, previousCredentials.cookies[0]]) {
        expect(visibleDiagnostics).not.toContain(secret);
      }
      const resolved = await readSession(session);
      expect(resolved.session.admin.email).toBe("admin@example.com");
      expect(resolved.session.dominations).toEqual(previousCredentials);
      expect(upstreamCalls(fetchMock)).toHaveLength(6);
    });
  });

  it("still asks for dashboard login when its own stored session has expired", async () => {
    stubEnvironment();
    const session = await createGoogleSession();
    session.store.values.clear();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = createConnectFetch(session.store.values);
    vi.stubGlobal("fetch", fetchMock);

    const response = await connectGoogleAccount(createRequest(session));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: { code: "AUTH_REQUIRED" } });
    expect(upstreamCalls(fetchMock)).toEqual([]);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(session.sealedCookie);
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

async function createGoogleSession(credentials?: DomiNationsCredential) {
  const store = new MemoryAuthStore();
  const created = await createServerAppSession(
    { subject: "google-subject", email: "admin@example.com", name: "Admin" },
    googleRefreshToken,
    getAuthConfig(),
    store,
  );
  if (credentials) {
    await attachDomiNationsSession(created.sealedCookie, credentials, getAuthConfig(), { store });
  }
  return {
    sealedCookie: created.sealedCookie,
    csrfToken: created.session.claimCsrfToken,
    store,
  };
}

function readSession(session: Awaited<ReturnType<typeof createGoogleSession>>) {
  return resolveServerAppSession(session.sealedCookie, getAuthConfig(), { store: session.store });
}

class MemoryAuthStore implements AuthKeyValueStore {
  readonly values = new Map<string, string>();

  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}

function createConnectFetch(
  redisValues: Map<string, string>,
  { googleStatus = 200, linkedIds = accountIds, listedIds = accountIds, accountResponse }: {
    googleStatus?: number;
    linkedIds?: string[];
    listedIds?: string[];
    accountResponse?: { path: string; respond: () => Response };
  } = {},
) {
  return vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === "https://redis.example") {
      const command = JSON.parse(String(init?.body)) as unknown[];
      const key = String(command[1] ?? "");
      if (command[0] === "GET") return Response.json({ result: redisValues.get(key) ?? null });
      if (command[0] === "SET") {
        redisValues.set(key, String(command[2] ?? ""));
        return Response.json({ result: "OK" });
      }
      throw new Error(`Unexpected Redis operation: ${String(command[0])}`);
    }
    if (url.href === "https://oauth2.googleapis.com/token") {
      return Response.json(
        googleStatus === 200
          ? { access_token: googleAccessToken, token_type: "Bearer", expires_in: 3600 }
          : { error: "invalid_grant" },
        { status: googleStatus },
      );
    }
    if (url.origin === "https://login.xsolla.com" && url.pathname === "/api/social/google/login_with_token") {
      return Response.json({ token: xsollaToken });
    }
    if (url.origin !== "https://api.dominationsworld.com") throw new Error("Unexpected upstream origin");
    if (url.pathname === accountResponse?.path) return accountResponse.respond();
    switch (url.pathname) {
      case "/api/accounts/signup":
        return Response.json(
          { authcode: "domi-auth-code", errorReason: "" },
          { headers: { "Set-Cookie": "auth_flow=flow-cookie; Path=/" } },
        );
      case "/api/accounts/token":
        return Response.json(
          { token: domiAccessToken, userid: "domi-user", xsid: "xsolla-user" },
          { headers: { "Set-Cookie": "domi_auth=auth-cookie; Path=/" } },
        );
      case "/api/gameident/dom/list":
        return Response.json({ gameIds: Object.fromEntries(listedIds.map((id) => [id, {}])) });
      case "/api/dominations/linked_user_info":
        return Response.json({ accounts: linkedIds.map((gameAccountId) => ({ gameAccountId, name: gameAccountId })) });
      default:
        throw new Error(`Unexpected upstream path: ${url.pathname}`);
    }
  });
}

function upstreamCalls(fetchMock: ReturnType<typeof createConnectFetch>) {
  return fetchMock.mock.calls.filter(([input]) => new URL(String(input)).origin !== "https://redis.example");
}

function createRequest({
  origin = "http://localhost:3000",
  sealedCookie,
  csrfToken,
}: {
  origin?: string;
  sealedCookie?: string;
  csrfToken?: string;
} = {}) {
  const headers = new Headers({ Origin: origin });
  if (sealedCookie) headers.set("Cookie", `domi_session=${sealedCookie}`);
  if (csrfToken) headers.set("X-Connect-CSRF", csrfToken);
  return new NextRequest("http://localhost:3000/api/auth/dominations/connect", { method: "POST", headers });
}
