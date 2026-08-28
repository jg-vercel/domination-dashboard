import "server-only";

import { AuthError } from "./errors";

export const OAUTH_FLOW_COOKIE = "domi_oauth_flow";
export const APP_SESSION_COOKIE = "domi_session";

export interface AuthEnvironment {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ADMIN_GOOGLE_EMAIL?: string;
  APP_SESSION_SECRET?: string;
  APP_BASE_URL?: string;
  NODE_ENV?: string;
}

export interface AuthConfig {
  googleClientId: string;
  googleClientSecret: string;
  adminGoogleEmail: string;
  sessionSecret: string;
  baseUrl: string;
  secureCookies: boolean;
}

export interface AuthReadiness {
  configured: boolean;
  missing: string[];
}

export function getAuthReadiness(
  environment: AuthEnvironment = readProcessEnvironment(),
): AuthReadiness {
  const missing: string[] = [];

  for (const key of [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "ADMIN_GOOGLE_EMAIL",
    "APP_SESSION_SECRET",
  ] as const) {
    if (!environment[key]?.trim()) {
      missing.push(key);
    }
  }

  if (
    environment.APP_SESSION_SECRET &&
    environment.APP_SESSION_SECRET.trim().length < 32
  ) {
    missing.push("APP_SESSION_SECRET_MIN_32_CHARS");
  }

  if (environment.NODE_ENV === "production" && !environment.APP_BASE_URL?.trim()) {
    missing.push("APP_BASE_URL");
  }

  return { configured: missing.length === 0, missing };
}

export function getAuthConfig(
  environment: AuthEnvironment = readProcessEnvironment(),
): AuthConfig {
  const readiness = getAuthReadiness(environment);
  if (!readiness.configured) {
    throw new AuthError("AUTH_NOT_CONFIGURED");
  }

  const baseUrl = normalizeBaseUrl(
    environment.APP_BASE_URL?.trim() || "http://localhost:3000",
  );

  return {
    googleClientId: environment.GOOGLE_CLIENT_ID!.trim(),
    googleClientSecret: environment.GOOGLE_CLIENT_SECRET!.trim(),
    adminGoogleEmail: environment.ADMIN_GOOGLE_EMAIL!.trim().toLowerCase(),
    sessionSecret: environment.APP_SESSION_SECRET!.trim(),
    baseUrl,
    secureCookies: baseUrl.startsWith("https://"),
  };
}

export function getGoogleRedirectUri(config: AuthConfig): string {
  return `${config.baseUrl}/api/auth/google/callback`;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new AuthError("AUTH_NOT_CONFIGURED", { cause: error });
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== "/") {
    throw new AuthError("AUTH_NOT_CONFIGURED");
  }

  return url.origin;
}

function readProcessEnvironment(): AuthEnvironment {
  return {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    ADMIN_GOOGLE_EMAIL: process.env.ADMIN_GOOGLE_EMAIL,
    APP_SESSION_SECRET: process.env.APP_SESSION_SECRET,
    APP_BASE_URL: process.env.APP_BASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  };
}
