// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST as claimAll } from "@/app/api/claims/free-legendary-token/route";
import { createAppSession } from "@/lib/auth/session";

const sessionSecret =
  "integration-claim-session-secret-with-at-least-32-characters";

describe("claim Route Handler safety boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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
    const { sealed } = createTestSession();

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
    const { sealed, csrfToken } = createTestSession();

    const response = await claimAll(
      createRequest({ sealedSession: sealed, csrfToken }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CLAIM_STORE_NOT_CONFIGURED" },
    });
  });
});

function stubAuthEnvironment() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
  vi.stubEnv("ADMIN_GOOGLE_EMAIL", "admin@example.com");
  vi.stubEnv("APP_SESSION_SECRET", sessionSecret);
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("NODE_ENV", "development");
}

function createTestSession() {
  const { session, sealed } = createAppSession(
    {
      subject: "google-subject",
      email: "admin@example.com",
      name: "Admin",
    },
    {
      accessToken: "dominations-bearer",
      cookies: ["domi=session"],
      userId: "user-1",
      xsollaId: "xsolla-1",
    },
    sessionSecret,
  );
  return { sealed, csrfToken: session.claimCsrfToken };
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
