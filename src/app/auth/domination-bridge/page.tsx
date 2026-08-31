import { cookies } from "next/headers";

import { DominationBridgeClient } from "@/components/domination-bridge-client";
import { APP_SESSION_COOKIE, getAuthConfig } from "@/lib/auth/config";
import { resolveServerAppSession } from "@/lib/auth/server-session";
import { getRedisReadiness } from "@/lib/idempotency/redis-rest";

export const dynamic = "force-dynamic";

export default async function DominationBridgePage() {
  let csrfToken: string | null = null;

  if (getRedisReadiness().configured) {
    try {
      const config = getAuthConfig();
      const sealedSession = (await cookies()).get(APP_SESSION_COOKIE)?.value;
      if (sealedSession) {
        const resolved = await resolveServerAppSession(sealedSession, config);
        csrfToken = resolved.session.claimCsrfToken;
      }
    } catch {
      csrfToken = null;
    }
  }

  return <DominationBridgeClient csrfToken={csrfToken} />;
}
