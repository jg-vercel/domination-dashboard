import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { APP_SESSION_COOKIE, getAuthConfig } from "@/lib/auth/config";
import { asAuthError } from "@/lib/auth/errors";
import { resolveServerAppSession } from "@/lib/auth/server-session";
import {
  APP_SESSION_COOKIE_TTL_SECONDS,
  authCookieOptions,
} from "@/lib/auth/session";
import {
  getRedisReadiness,
  RedisStoreError,
} from "@/lib/idempotency/redis-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  try {
    const config = getAuthConfig();
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(config.baseUrl).origin) {
      return errorResponse("ORIGIN_REJECTED", 403);
    }

    const sealedSession = request.cookies.get(APP_SESSION_COOKIE)?.value;
    if (!sealedSession) {
      return errorResponse("AUTH_REQUIRED", 401);
    }
    if (!getRedisReadiness().configured) {
      return errorResponse("SESSION_STORE_NOT_CONFIGURED", 503);
    }

    const resolved = await resolveServerAppSession(sealedSession, config);
    const response = new NextResponse(null, {
      status: 204,
      headers: noStoreHeaders,
    });
    response.cookies.set(
      APP_SESSION_COOKIE,
      resolved.sealedCookie,
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
      authError.code === "SESSION_INVALID" ||
      authError.code === "GOOGLE_REFRESH_REJECTED"
    ) {
      return errorResponse("AUTH_REQUIRED", 401);
    }
    if (authError.code === "AUTH_NOT_CONFIGURED") {
      return errorResponse("AUTH_NOT_CONFIGURED", 503);
    }
    return errorResponse("SESSION_REFRESH_FAILED", 502);
  }
}

function errorResponse(code: string, status: number) {
  return NextResponse.json(
    { ok: false, error: { code } },
    { status, headers: noStoreHeaders },
  );
}
