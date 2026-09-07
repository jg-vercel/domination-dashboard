import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { APP_SESSION_COOKIE, getAuthConfig } from "@/lib/auth/config";
import { secureStringEqual } from "@/lib/auth/crypto";
import { asAuthError } from "@/lib/auth/errors";
import {
  connectStoredGoogleSession,
  resolveServerAppSession,
} from "@/lib/auth/server-session";
import { APP_SESSION_COOKIE_TTL_SECONDS, authCookieOptions } from "@/lib/auth/session";
import { getRedisReadiness, RedisStoreError } from "@/lib/idempotency/redis-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  try {
    const config = getAuthConfig();
    if (request.headers.get("origin") !== new URL(config.baseUrl).origin) {
      return errorResponse("ORIGIN_REJECTED", 403);
    }
    const sealedCookie = request.cookies.get(APP_SESSION_COOKIE)?.value;
    if (!sealedCookie) return errorResponse("AUTH_REQUIRED", 401);
    if (!getRedisReadiness().configured) {
      return errorResponse("SESSION_STORE_NOT_CONFIGURED", 503);
    }

    const current = await resolveServerAppSession(sealedCookie, config);
    const csrfToken = request.headers.get("x-connect-csrf");
    if (!csrfToken || !secureStringEqual(csrfToken, current.session.claimCsrfToken)) {
      return errorResponse("CSRF_REJECTED", 403);
    }

    const connected = await connectStoredGoogleSession(sealedCookie, config);
    const response = NextResponse.json(
      { ok: true, accountCount: 3 },
      { headers: noStoreHeaders },
    );
    response.cookies.set(
      APP_SESSION_COOKIE,
      connected.sealedCookie,
      authCookieOptions(config.secureCookies, APP_SESSION_COOKIE_TTL_SECONDS),
    );
    return response;
  } catch (error) {
    if (error instanceof RedisStoreError) {
      return errorResponse("SESSION_STORE_UNAVAILABLE", 503);
    }
    const { code } = asAuthError(error);
    if (code === "SESSION_INVALID" || code === "SESSION_EXPIRED") {
      return errorResponse("AUTH_REQUIRED", 401);
    }
    if (code === "GOOGLE_REFRESH_REJECTED" || code === "GOOGLE_REFRESH_TOKEN_MISSING") {
      return errorResponse(code, 401);
    }
    if (code === "ACCOUNT_COUNT_MISMATCH") return errorResponse(code, 409);
    if (code === "AUTH_NOT_CONFIGURED") return errorResponse(code, 503);
    return errorResponse(code, 502);
  }
}

function errorResponse(code: string, status: number) {
  return NextResponse.json(
    { ok: false, error: { code } },
    { status, headers: noStoreHeaders },
  );
}
