import { NextResponse } from "next/server";

import { getAuthConfig, OAUTH_FLOW_COOKIE } from "@/lib/auth/config";
import { asAuthError } from "@/lib/auth/errors";
import { buildGoogleAuthorizationUrl } from "@/lib/auth/google";
import {
  authCookieOptions,
  createOAuthFlow,
  OAUTH_FLOW_TTL_SECONDS,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const config = getAuthConfig();
    const { flow, sealed } = createOAuthFlow(config.sessionSecret);
    const response = NextResponse.redirect(
      buildGoogleAuthorizationUrl(config, flow),
    );
    response.cookies.set(
      OAUTH_FLOW_COOKIE,
      sealed,
      authCookieOptions(config.secureCookies, OAUTH_FLOW_TTL_SECONDS),
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const authError = asAuthError(error);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: authError.code,
          message: "Google 로그인 설정을 확인해 주세요.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
