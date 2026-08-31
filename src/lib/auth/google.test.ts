import { describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "./config";
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  refreshGoogleAccessToken,
} from "./google";
import type { OAuthFlow } from "./session";

const config: AuthConfig = {
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
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
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toContain("consent");
    expect(url.toString()).not.toContain(config.googleClientSecret);
  });

  it("exchanges a code server-side with a required refresh token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: "google-access-token",
        refresh_token: "google-refresh-token",
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
      refreshToken: "google-refresh-token",
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

  it("rejects an exchange that does not return a refresh token", async () => {
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
      email: "user@example.com",
      name: "User",
    });

    await expect(
      exchangeGoogleAuthorizationCode(
        config,
        flow,
        "authorization-code",
        fetchMock,
        verifier,
      ),
    ).rejects.toMatchObject({ code: "GOOGLE_REFRESH_TOKEN_MISSING" });
  });

  it("refreshes a Google access token without returning the refresh token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: "renewed-access-token",
        expires_in: 3_600,
        token_type: "Bearer",
      }),
    );

    await expect(
      refreshGoogleAccessToken(config, "stored-refresh-token", fetchMock),
    ).resolves.toBe("renewed-access-token");
    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("stored-refresh-token");
  });

  it("fails closed when Google rejects a stored refresh token", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 400 }));

    await expect(
      refreshGoogleAccessToken(config, "revoked-refresh-token", fetchMock),
    ).rejects.toMatchObject({ code: "GOOGLE_REFRESH_REJECTED" });
  });
});
