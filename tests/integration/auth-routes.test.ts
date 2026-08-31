// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET as startGoogleLogin } from "@/app/api/auth/google/start/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as refreshSession } from "@/app/api/auth/session/route";

describe("auth Route Handlers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails safely when OAuth environment variables are absent", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    vi.stubEnv("APP_SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");

    const response = startGoogleLogin();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      error: {
        code: "AUTH_NOT_CONFIGURED",
        message: "Google 로그인 설정을 확인해 주세요.",
      },
    });
  });

  it("sets an encrypted HttpOnly flow cookie before Google redirect", () => {
    stubValidAuthEnvironment();

    const response = startGoogleLogin();
    const location = new URL(response.headers.get("location")!);
    const cookie = response.headers.get("set-cookie")!;

    expect(response.status).toBe(307);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(cookie).toContain("domi_oauth_flow=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).not.toContain(location.searchParams.get("state")!);
  });

  it("rejects cross-origin logout and clears same-origin sessions", async () => {
    stubValidAuthEnvironment();

    const rejected = await logout(
      new NextRequest("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
      }),
    );
    expect(rejected.status).toBe(403);

    const accepted = await logout(
      new NextRequest("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: { Origin: "http://localhost:3000" },
      }),
    );
    expect(accepted.status).toBe(303);
    expect(accepted.headers.get("set-cookie")).toContain("domi_session=");
    expect(accepted.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("requires same-origin and an existing cookie for session keepalive", async () => {
    stubValidAuthEnvironment();

    const crossOrigin = await refreshSession(
      new NextRequest("http://localhost:3000/api/auth/session", {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
      }),
    );
    expect(crossOrigin.status).toBe(403);

    const missingCookie = await refreshSession(
      new NextRequest("http://localhost:3000/api/auth/session", {
        method: "POST",
        headers: { Origin: "http://localhost:3000" },
      }),
    );
    expect(missingCookie.status).toBe(401);
  });
});

function stubValidAuthEnvironment() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
  vi.stubEnv(
    "APP_SESSION_SECRET",
    "integration-session-secret-with-at-least-32-characters",
  );
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("NODE_ENV", "development");
}
