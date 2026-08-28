import "server-only";

import { createPkcePair, createRandomToken, sealPayload, unsealPayload } from "./crypto";

export const OAUTH_FLOW_TTL_SECONDS = 10 * 60;
export const APP_SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface OAuthFlow {
  issuedAt: number;
  expiresAt: number;
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
}

export interface AdminIdentity {
  subject: string;
  email: string;
  name: string;
  picture?: string;
}

export interface DomiNationsCredential {
  accessToken: string;
  cookies: string[];
  userId: string;
  xsollaId: string;
}

export interface AppSession {
  issuedAt: number;
  expiresAt: number;
  admin: AdminIdentity;
  dominations: DomiNationsCredential;
  claimCsrfToken: string;
}

export function createOAuthFlow(
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): { flow: OAuthFlow; sealed: string } {
  const pkce = createPkcePair();
  const flow: OAuthFlow = {
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + OAUTH_FLOW_TTL_SECONDS,
    state: createRandomToken(),
    nonce: createRandomToken(),
    codeVerifier: pkce.verifier,
    codeChallenge: pkce.challenge,
  };

  return { flow, sealed: sealPayload(flow, secret) };
}

export function readOAuthFlow(
  sealed: string,
  secret: string,
  nowSeconds?: number,
): OAuthFlow {
  return unsealPayload<OAuthFlow>(sealed, secret, nowSeconds);
}

export function createAppSession(
  admin: AdminIdentity,
  dominations: DomiNationsCredential,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): { session: AppSession; sealed: string } {
  const session: AppSession = {
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + APP_SESSION_TTL_SECONDS,
    admin,
    dominations,
    claimCsrfToken: createRandomToken(),
  };

  return { session, sealed: sealPayload(session, secret) };
}

export function readAppSession(
  sealed: string,
  secret: string,
  nowSeconds?: number,
): AppSession {
  return unsealPayload<AppSession>(sealed, secret, nowSeconds);
}

export function authCookieOptions(
  secure: boolean,
  maxAge: number,
): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  };
}
