import "server-only";

import { createPkcePair, createRandomToken, sealPayload, unsealPayload } from "./crypto";
import { AuthError } from "./errors";

export const OAUTH_FLOW_TTL_SECONDS = 10 * 60;
export const APP_SESSION_IDLE_TTL_SECONDS = 180 * 24 * 60 * 60;
export const APP_SESSION_COOKIE_TTL_SECONDS = 400 * 24 * 60 * 60;

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
  dominations: DomiNationsCredential | null;
  claimCsrfToken: string;
}

export interface AppSessionPointer {
  issuedAt: number;
  expiresAt: number;
  sessionId: string;
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

export function createAppSessionPointer(
  sessionId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): { pointer: AppSessionPointer; sealed: string } {
  const pointer: AppSessionPointer = {
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + APP_SESSION_COOKIE_TTL_SECONDS,
    sessionId,
  };

  return { pointer, sealed: sealPayload(pointer, secret) };
}

export function readAppSessionPointer(
  sealed: string,
  secret: string,
  nowSeconds?: number,
): AppSessionPointer {
  const pointer = unsealPayload<AppSessionPointer>(sealed, secret, nowSeconds);
  if (typeof pointer.sessionId !== "string" || pointer.sessionId.length < 32) {
    throw new AuthError("SESSION_INVALID");
  }
  return pointer;
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
