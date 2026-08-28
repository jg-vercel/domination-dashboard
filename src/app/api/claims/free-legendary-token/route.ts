import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  APP_SESSION_COOKIE,
  getAuthConfig,
} from "@/lib/auth/config";
import { secureStringEqual } from "@/lib/auth/crypto";
import { asAuthError } from "@/lib/auth/errors";
import { readAppSession } from "@/lib/auth/session";
import {
  BatchClaimInProgressError,
  claimFreeLegendaryTokenForAllAccounts,
} from "@/lib/claims/service";
import {
  createRedisClaimStore,
  getRedisReadiness,
  RedisStoreError,
} from "@/lib/idempotency/redis-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

    const session = readAppSession(sealedSession, config.sessionSecret);
    const csrfToken = request.headers.get("x-claim-csrf");
    if (!csrfToken || !secureStringEqual(csrfToken, session.claimCsrfToken)) {
      return errorResponse("CSRF_REJECTED", 403);
    }

    if (!getRedisReadiness().configured) {
      return errorResponse("CLAIM_STORE_NOT_CONFIGURED", 503);
    }

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store: createRedisClaimStore(),
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof BatchClaimInProgressError) {
      return errorResponse("BATCH_IN_PROGRESS", 409);
    }
    if (error instanceof RedisStoreError) {
      return errorResponse("CLAIM_STORE_UNAVAILABLE", 503);
    }

    const authError = asAuthError(error);
    if (authError.code === "SESSION_EXPIRED" || authError.code === "SESSION_INVALID") {
      return errorResponse("AUTH_REQUIRED", 401);
    }
    if (authError.code === "ACCOUNT_COUNT_MISMATCH") {
      return errorResponse("ACCOUNT_COUNT_MISMATCH", 409);
    }
    if (authError.code === "AUTH_NOT_CONFIGURED") {
      return errorResponse("CLAIM_NOT_CONFIGURED", 503);
    }
    return errorResponse("CLAIM_FAILED_SAFELY", 502);
  }
}

function errorResponse(code: string, status: number) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message: "무료 토큰 수령을 안전하게 완료하지 못했습니다.",
      },
    },
    { status, headers: noStoreHeaders },
  );
}
