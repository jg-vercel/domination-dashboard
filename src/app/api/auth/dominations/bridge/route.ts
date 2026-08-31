import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { APP_SESSION_COOKIE, getAuthConfig } from "@/lib/auth/config";
import { secureStringEqual } from "@/lib/auth/crypto";
import { asAuthError } from "@/lib/auth/errors";
import {
  attachDomiNationsSession,
  resolveServerAppSession,
} from "@/lib/auth/server-session";
import {
  APP_SESSION_COOKIE_TTL_SECONDS,
  authCookieOptions,
} from "@/lib/auth/session";
import { loadAccountDirectory } from "@/lib/dashboard/snapshot";
import { connectDomiNationsWithXsollaToken } from "@/lib/dominations/client";
import {
  getRedisReadiness,
  RedisStoreError,
} from "@/lib/idempotency/redis-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BRIDGE_BODY_LENGTH = 16_384;
const XSOLLA_JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const noStoreHeaders = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  try {
    const config = getAuthConfig();
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(config.baseUrl).origin) {
      return errorResponse("ORIGIN_REJECTED", 403);
    }
    if (!getRedisReadiness().configured) {
      return errorResponse("SESSION_STORE_NOT_CONFIGURED", 503);
    }

    const sealedSession = request.cookies.get(APP_SESSION_COOKIE)?.value;
    if (!sealedSession) {
      return errorResponse("AUTH_REQUIRED", 401);
    }
    const resolved = await resolveServerAppSession(sealedSession, config);
    const csrfToken = request.headers.get("x-bridge-csrf");
    if (
      !csrfToken ||
      !secureStringEqual(csrfToken, resolved.session.claimCsrfToken)
    ) {
      return errorResponse("CSRF_REJECTED", 403);
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BRIDGE_BODY_LENGTH) {
      return errorResponse("BRIDGE_TOKEN_INVALID", 400);
    }
    const bodyText = await request.text();
    if (bodyText.length === 0 || bodyText.length > MAX_BRIDGE_BODY_LENGTH) {
      return errorResponse("BRIDGE_TOKEN_INVALID", 400);
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      return errorResponse("BRIDGE_TOKEN_INVALID", 400);
    }
    const xsollaToken = readXsollaToken(body);
    if (!xsollaToken) {
      return errorResponse("BRIDGE_TOKEN_INVALID", 400);
    }

    const dominations = await connectDomiNationsWithXsollaToken(xsollaToken);
    const accounts = await loadAccountDirectory(dominations);
    const attached = await attachDomiNationsSession(
      sealedSession,
      dominations,
      config,
    );
    const response = NextResponse.json(
      { ok: true, accountCount: accounts.length },
      { headers: noStoreHeaders },
    );
    response.cookies.set(
      APP_SESSION_COOKIE,
      attached.sealedCookie,
      authCookieOptions(
        config.secureCookies,
        APP_SESSION_COOKIE_TTL_SECONDS,
      ),
    );
    return response;
  } catch (error) {
    if (error instanceof RedisStoreError) {
      return errorResponse("SESSION_STORE_UNAVAILABLE", 503);
    }
    const authError = asAuthError(error);
    if (
      authError.code === "SESSION_EXPIRED" ||
      authError.code === "SESSION_INVALID"
    ) {
      return errorResponse("AUTH_REQUIRED", 401);
    }
    if (
      authError.code === "DOMINATIONS_SIGNUP_REJECTED" ||
      authError.code === "DOMINATIONS_TOKEN_REJECTED"
    ) {
      return errorResponse("BRIDGE_TOKEN_REJECTED", 401);
    }
    if (authError.code === "ACCOUNT_COUNT_MISMATCH") {
      return errorResponse("ACCOUNT_COUNT_MISMATCH", 409);
    }
    if (authError.code === "AUTH_NOT_CONFIGURED") {
      return errorResponse("BRIDGE_NOT_CONFIGURED", 503);
    }
    return errorResponse("BRIDGE_FAILED_SAFELY", 502);
  }
}

function readXsollaToken(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const token = (value as Record<string, unknown>).xsollaToken;
  if (
    typeof token !== "string" ||
    token.length < 64 ||
    token.length > 12_000 ||
    !XSOLLA_JWT_PATTERN.test(token)
  ) {
    return null;
  }
  return token;
}

function errorResponse(code: string, status: number) {
  return NextResponse.json(
    { ok: false, error: { code } },
    { status, headers: noStoreHeaders },
  );
}
