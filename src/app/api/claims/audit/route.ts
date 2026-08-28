import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { APP_SESSION_COOKIE, getAuthConfig } from "@/lib/auth/config";
import { asAuthError } from "@/lib/auth/errors";
import { readAppSession } from "@/lib/auth/session";
import { listClaimAudits } from "@/lib/claims/audit";
import {
  createRedisClaimStore,
  getRedisReadiness,
  RedisStoreError,
} from "@/lib/idempotency/redis-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const config = getAuthConfig();
    const sealedSession = request.cookies.get(APP_SESSION_COOKIE)?.value;
    if (!sealedSession) return errorResponse("AUTH_REQUIRED", 401);

    const session = readAppSession(sealedSession, config.sessionSecret);
    if (!getRedisReadiness().configured) {
      return errorResponse("CLAIM_STORE_NOT_CONFIGURED", 503);
    }

    const audits = await listClaimAudits(
      session.admin.subject,
      createRedisClaimStore(),
      10,
    );
    return NextResponse.json(
      { ok: true, audits },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof RedisStoreError) {
      return errorResponse("CLAIM_STORE_UNAVAILABLE", 503);
    }
    const authError = asAuthError(error);
    if (authError.code === "SESSION_EXPIRED" || authError.code === "SESSION_INVALID") {
      return errorResponse("AUTH_REQUIRED", 401);
    }
    if (authError.code === "AUTH_NOT_CONFIGURED") {
      return errorResponse("CLAIM_NOT_CONFIGURED", 503);
    }
    return errorResponse("AUDIT_UNAVAILABLE", 502);
  }
}

function errorResponse(code: string, status: number) {
  return NextResponse.json(
    { ok: false, error: { code, message: "최근 실행 기록을 확인하지 못했습니다." } },
    { status, headers: noStoreHeaders },
  );
}
