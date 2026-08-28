import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { APP_SESSION_COOKIE, getAuthConfig } from "@/lib/auth/config";
import { authCookieOptions } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: NextRequest) {
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

  const response = NextResponse.redirect(new URL("/", baseUrl), 303);
  response.cookies.set(APP_SESSION_COOKIE, "", {
    ...authCookieOptions(secure, 0),
    expires: new Date(0),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
