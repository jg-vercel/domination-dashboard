import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { APP_SESSION_COOKIE, getAuthConfig } from "@/lib/auth/config";
import { destroyServerAppSession } from "@/lib/auth/server-session";
import { authCookieOptions } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let baseUrl = request.nextUrl.origin;
  let secure = request.nextUrl.protocol === "https:";

  try {
    const config = getAuthConfig();
    baseUrl = config.baseUrl;
    secure = config.secureCookies;
  } catch {
    // Clearing a local invalid session remains safe when configuration is absent.
  }

  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== new URL(baseUrl).origin) {
    return NextResponse.json(
      { ok: false, error: { code: "ORIGIN_REJECTED" } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const config = getAuthConfig();
    await destroyServerAppSession(
      request.cookies.get(APP_SESSION_COOKIE)?.value,
      config.sessionSecret,
    );
  } catch {
    // The browser session is still cleared when the provider or Redis is
    // unavailable. No upstream credential is stored in the cookie itself.
  }

  const response = NextResponse.redirect(new URL("/", baseUrl), 303);
  response.cookies.set(APP_SESSION_COOKIE, "", {
    ...authCookieOptions(secure, 0),
    expires: new Date(0),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
