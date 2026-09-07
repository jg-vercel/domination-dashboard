// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as completeGoogleLogin } from "@/app/api/auth/google/callback/route";
import { getAuthConfig } from "@/lib/auth/config";
import { AuthError } from "@/lib/auth/errors";
import { exchangeGoogleAuthorizationCode } from "@/lib/auth/google";
import { resolveServerAppSession } from "@/lib/auth/server-session";
import { createOAuthFlow } from "@/lib/auth/session";

vi.mock("@/lib/auth/google", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/google")>();
  return { ...actual, exchangeGoogleAuthorizationCode: vi.fn() };
});

const sessionSecret = "integration-google-callback-secret-at-least-32-characters";
const googleExchange = vi.mocked(exchangeGoogleAuthorizationCode);
const googleIdentity = { subject: "google-subject", email: "admin@example.com", name: "Admin" };

describe("Google callback direct store connection", () => {
  afterEach(() => {
    googleExchange.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([0, 1, 2, 3, 4, 6])("returns a connected dashboard session with %i accounts and empty signup errorReason", async (count) => {
    const ids = Array.from({ length: count }, (_, index) => `account-${index}`);
    const { redisValues, fetchMock } = setupCallback(false, ids);

    const response = await completeGoogleLogin(callbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/?auth=connected");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.cookies.get("domi_oauth_flow")?.value).toBe("");
    const sealedCookie = response.cookies.get("domi_session")?.value;
    expect(sealedCookie).toBeTruthy();
    const resolved = await resolveServerAppSession(sealedCookie!, getAuthConfig());
    expect(resolved.session.admin).toEqual(googleIdentity);
    expect(resolved.session.dominations?.accessToken).toBe("callback-domi-token");

    const xsollaCall = fetchMock.mock.calls.find(([input]) => String(input).startsWith("https://login.xsolla.com/"));
    expect(JSON.parse(String(xsollaCall?.[1]?.body))).toEqual({ access_token: "callback-google-access-token" });
    const externallyVisibleValues = [response.headers.get("set-cookie") ?? "", ...redisValues.values()].join("\n");
    for (const token of ["callback-domi-token", "callback-google-refresh-token", "callback-google-access-token", "callback-xsolla-token"]) {
      expect(externallyVisibleValues).not.toContain(token);
    }
    expect(upstreamPaths(fetchMock)).toEqual([
      "/api/social/google/login_with_token",
      "/api/accounts/signup",
      "/api/accounts/token",
      "/api/gameident/dom/list",
      "/api/dominations/linked_user_info",
    ]);
  });

  it("keeps the Google dashboard login for retry when the store rejects authentication", async () => {
    const { fetchMock } = setupCallback(true);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await completeGoogleLogin(callbackRequest());

    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("auth")).toBe("connected");
    expect(location.searchParams.get("auth_error")).toBe("DOMINATIONS_SIGNUP_REJECTED");
    const sealedCookie = response.cookies.get("domi_session")?.value;
    expect(sealedCookie).toBeTruthy();
    const resolved = await resolveServerAppSession(sealedCookie!, getAuthConfig());
    expect(resolved.session.admin).toEqual(googleIdentity);
    expect(resolved.session.dominations).toBeNull();
    expect(resolved.session.claimCsrfToken.length).toBeGreaterThanOrEqual(32);
    expect(upstreamPaths(fetchMock)).toEqual([
      "/api/social/google/login_with_token",
      "/api/accounts/signup",
    ]);
  });

  it("does not issue a dashboard session or contact the store when Google authentication fails", async () => {
    const { fetchMock, redisValues } = setupCallback();
    googleExchange.mockRejectedValueOnce(new AuthError("GOOGLE_TOKEN_REJECTED"));

    const response = await completeGoogleLogin(callbackRequest());

    expect(new URL(response.headers.get("location")!).searchParams.get("auth_error")).toBe("GOOGLE_TOKEN_REJECTED");
    expect(response.cookies.get("domi_session")).toBeUndefined();
    expect(response.cookies.get("domi_oauth_flow")?.value).toBe("");
    expect(redisValues.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an incorrect OAuth state before exchanging credentials", async () => {
    const { fetchMock } = setupCallback();

    const response = await completeGoogleLogin(callbackRequest("incorrect-state"));

    expect(new URL(response.headers.get("location")!).searchParams.get("auth_error")).toBe("OAUTH_FLOW_INVALID");
    expect(response.cookies.get("domi_session")).toBeUndefined();
    expect(googleExchange).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function setupCallback(rejectStore = false, ids = ["account-1", "account-2", "account-3"]) {
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
  vi.stubEnv("APP_SESSION_SECRET", sessionSecret);
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-secret-token");
  googleExchange.mockResolvedValue({
    identity: googleIdentity,
    accessToken: "callback-google-access-token",
    refreshToken: "callback-google-refresh-token",
  });
  const redisValues = new Map<string, string>();
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
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
    if (url.origin === "https://login.xsolla.com" && url.pathname === "/api/social/google/login_with_token") {
      return Response.json({ token: "callback-xsolla-token" });
    }
    if (url.origin !== "https://api.dominationsworld.com") throw new Error("Unexpected upstream origin");
    switch (url.pathname) {
      case "/api/accounts/signup":
        return Response.json(rejectStore
          ? { errorReason: "wrongCredentials", authcode: "" }
          : { authcode: "callback-authcode", errorReason: "" });
      case "/api/accounts/token":
        return Response.json({ token: "callback-domi-token", userid: "domi-user", xsid: "xsolla-user" });
      case "/api/gameident/dom/list":
        return Response.json({ gameIds: Object.fromEntries(ids.map((id) => [id, {}])) });
      case "/api/dominations/linked_user_info":
        return Response.json({ accounts: ids.map((gameAccountId) => ({ gameAccountId, name: gameAccountId })) });
      default:
        throw new Error(`Unexpected upstream path: ${url.pathname}`);
    }
  });
  vi.stubGlobal("fetch", fetchMock);
  return { redisValues, fetchMock };
}

function callbackRequest(stateOverride?: string) {
  const { flow, sealed } = createOAuthFlow(sessionSecret);
  const url = new URL("http://localhost:3000/api/auth/google/callback");
  url.searchParams.set("code", "google-authorization-code");
  url.searchParams.set("state", stateOverride ?? flow.state);
  return new NextRequest(url, { headers: { Cookie: `domi_oauth_flow=${sealed}` } });
}

function upstreamPaths(fetchMock: ReturnType<typeof setupCallback>["fetchMock"]) {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.origin !== "https://redis.example")
    .map((url) => url.pathname);
}
