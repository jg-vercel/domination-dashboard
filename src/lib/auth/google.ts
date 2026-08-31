import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";

import type { AuthConfig } from "./config";
import { getGoogleRedirectUri } from "./config";
import { AuthError } from "./errors";
import type { AdminIdentity, OAuthFlow } from "./session";

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_REQUEST_TIMEOUT_MS = 8_000;

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface GoogleRefreshResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface GoogleExchangeResult {
  accessToken: string;
  refreshToken: string;
  identity: AdminIdentity;
}

export type GoogleIdTokenVerifier = (
  idToken: string,
  config: AuthConfig,
  expectedNonce: string,
) => Promise<AdminIdentity>;

export function buildGoogleAuthorizationUrl(
  config: AuthConfig,
  flow: OAuthFlow,
): URL {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: getGoogleRedirectUri(config),
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: flow.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
  }).toString();
  return url;
}

export async function exchangeGoogleAuthorizationCode(
  config: AuthConfig,
  flow: OAuthFlow,
  code: string,
  fetchImplementation: typeof fetch = fetch,
  verifyIdToken: GoogleIdTokenVerifier = verifyGoogleIdToken,
): Promise<GoogleExchangeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImplementation(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: getGoogleRedirectUri(config),
        grant_type: "authorization_code",
        code_verifier: flow.codeVerifier,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AuthError("GOOGLE_TOKEN_REJECTED");
    }

    const payload = (await safeJson(response)) as Partial<GoogleTokenResponse>;
    if (
      typeof payload.access_token !== "string" ||
      typeof payload.id_token !== "string" ||
      typeof payload.expires_in !== "number" ||
      payload.token_type?.toLowerCase() !== "bearer"
    ) {
      throw new AuthError("GOOGLE_TOKEN_REJECTED");
    }

    const identity = await verifyIdToken(
      payload.id_token,
      config,
      flow.nonce,
    );

    if (typeof payload.refresh_token !== "string" || !payload.refresh_token) {
      throw new AuthError("GOOGLE_REFRESH_TOKEN_MISSING");
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      identity,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError("UPSTREAM_UNAVAILABLE", { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshGoogleAccessToken(
  config: AuthConfig,
  refreshToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImplementation(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AuthError("GOOGLE_REFRESH_REJECTED");
    }

    const payload = (await safeJson(response)) as Partial<GoogleRefreshResponse>;
    if (
      typeof payload.access_token !== "string" ||
      !payload.access_token ||
      typeof payload.expires_in !== "number" ||
      payload.token_type?.toLowerCase() !== "bearer"
    ) {
      throw new AuthError("GOOGLE_REFRESH_REJECTED");
    }
    return payload.access_token;
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === "GOOGLE_TOKEN_REJECTED") {
        throw new AuthError("GOOGLE_REFRESH_REJECTED", { cause: error });
      }
      throw error;
    }
    throw new AuthError("UPSTREAM_UNAVAILABLE", { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyGoogleIdToken(
  idToken: string,
  config: AuthConfig,
  expectedNonce: string,
): Promise<AdminIdentity> {
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: GOOGLE_ISSUERS,
      audience: config.googleClientId,
      algorithms: ["RS256"],
    });

    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      payload.email_verified !== true ||
      payload.nonce !== expectedNonce
    ) {
      throw new AuthError("GOOGLE_TOKEN_REJECTED");
    }

    return {
      subject: payload.sub,
      email: payload.email.toLowerCase(),
      name: typeof payload.name === "string" ? payload.name : payload.email,
      picture:
        typeof payload.picture === "string" ? payload.picture : undefined,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError("GOOGLE_TOKEN_REJECTED", { cause: error });
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new AuthError("GOOGLE_TOKEN_REJECTED", { cause: error });
  }
}
