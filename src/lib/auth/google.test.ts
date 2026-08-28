import { describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "./config";
import { buildGoogleAuthorizationUrl, exchangeGoogleAuthorizationCode } from "./google";
import type { OAuthFlow } from "./session";

const config: AuthConfig = {
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  adminGoogleEmail: "admin@example.com",
  sessionSecret: "session-secret-with-at-least-32-characters",
  baseUrl: "http://localhost:3000",
  secureCookies: false,
};

const flow: OAuthFlow = {
  issuedAt: 1_000,
  expiresAt: 1_600,
  state: "state-longer-than-eight-characters",
  nonce: "nonce-value",
  codeVerifier: "pkce-verifier",
  codeChallenge: "pkce-challenge",
};

describe("Google OAuth", () => {
  it("builds an authorization-code URL with CSRF and PKCE values", () => {
    const url = buildGoogleAuthorizationUrl(config, flow);

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe(flow.state);
    expect(url.searchParams.get("nonce")).toBe(flow.nonce);
    expect(url.searchParams.get("code_challenge")).toBe(flow.codeChallenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain(config.googleClientSecret);
  });

  it("exchanges a code server-side and allows the configured admin", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: "google-access-token",
        id_token: "google-id-token",
        expires_in: 3_600,
        token_type: "Bearer",
      }),
    );
    const verifier = vi.fn().mockResolvedValue({
      subject: "google-subject",
      email: "admin@example.com",
      name: "Admin",
    });

    await expect(
      exchangeGoogleAuthorizationCode(
        config,
        flow,
        "authorization-code",
        fetchMock,
        verifier,
      ),
    ).resolves.toEqual({
      accessToken: "google-access-token",
      identity: {
        subject: "google-subject",
        email: "admin@example.com",
        name: "Admin",
      },
    });

    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(requestBody).toBeInstanceOf(URLSearchParams);
    expect((requestBody as URLSearchParams).get("code_verifier")).toBe(
      flow.codeVerifier,
    );
    expect(verifier).toHaveBeenCalledWith(
      "google-id-token",
      config,
      flow.nonce,
    );
  });

  it("rejects a verified but non-admin Google account", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: "google-access-token",
        id_token: "google-id-token",
        expires_in: 3_600,
        token_type: "Bearer",
      }),
    );
    const verifier = vi.fn().mockResolvedValue({
      subject: "other-subject",
      email: "other@example.com",
      name: "Other",
    });

    await expect(
      exchangeGoogleAuthorizationCode(
        config,
        flow,
        "authorization-code",
        fetchMock,
        verifier,
      ),
    ).rejects.toMatchObject({ code: "ADMIN_NOT_ALLOWED" });
  });
});
