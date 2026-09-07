import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  APP_SESSION_COOKIE,
  getAuthConfig,
  OAUTH_FLOW_COOKIE,
} from "@/lib/auth/config";
import { secureStringEqual } from "@/lib/auth/crypto";
import { asAuthError, AuthError } from "@/lib/auth/errors";
import { exchangeGoogleAuthorizationCode } from "@/lib/auth/google";
import {
  APP_SESSION_COOKIE_TTL_SECONDS,
  authCookieOptions,
  readOAuthFlow,
} from "@/lib/auth/session";
import {
  attachDomiNationsSession,
  createServerAppSession,
} from "@/lib/auth/server-session";
import { loadAccountDirectory } from "@/lib/dashboard/snapshot";
import { connectDomiNations } from "@/lib/dominations/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  let baseUrl = request.nextUrl.origin;

  try {
    const config = getAuthConfig();
    baseUrl = config.baseUrl;
    const providerError = request.nextUrl.searchParams.get("error");
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const sealedFlow = request.cookies.get(OAUTH_FLOW_COOKIE)?.value;

    if (providerError) {
      throw new AuthError("OAUTH_PROVIDER_ERROR");
    }
    if (!code || !state || !sealedFlow) {
      throw new AuthError("OAUTH_FLOW_INVALID");
    }

    const flow = readOAuthFlow(sealedFlow, config.sessionSecret);
    if (!secureStringEqual(flow.state, state)) {
      throw new AuthError("OAUTH_FLOW_INVALID");
    }

    const google = await exchangeGoogleAuthorizationCode(config, flow, code);

    let resolved = await createServerAppSession(
      google.identity,
      google.refreshToken,
      config,
    );
    const redirectUrl = new URL("/?auth=connected", config.baseUrl);
    try {
      const dominations = await connectDomiNations(google.accessToken);
      await loadAccountDirectory(dominations);
      resolved = await attachDomiNationsSession(resolved.sealedCookie, dominations, config);
    } catch (error) {
      // Preserve the dashboard login so the same Google account can retry.
      redirectUrl.searchParams.set("auth_error", asAuthError(error).code);
    }
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set(
      APP_SESSION_COOKIE,
      resolved.sealedCookie,
      authCookieOptions(
        config.secureCookies,
        APP_SESSION_COOKIE_TTL_SECONDS,
      ),
    );
    clearFlowCookie(response, config.secureCookies);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const authError = asAuthError(error);
    const redirectUrl = new URL("/", baseUrl);
    redirectUrl.searchParams.set("auth_error", authError.code);
    const response = NextResponse.redirect(redirectUrl);
    clearFlowCookie(response, redirectUrl.protocol === "https:");
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

function clearFlowCookie(response: NextResponse, secure: boolean) {
  response.cookies.set(OAUTH_FLOW_COOKIE, "", {
    ...authCookieOptions(secure, 0),
    expires: new Date(0),
  });
}
