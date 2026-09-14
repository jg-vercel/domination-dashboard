"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const RENEW_INTERVAL_MS = 60 * 60 * 1_000;
const EVENT_THROTTLE_MS = 5 * 60 * 1_000;

export function SessionKeepalive({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;

    let disposed = false;
    let expired = false;
    let inFlight = false;
    let lastAttempt = -Infinity;

    async function renew() {
      if (
        disposed || expired || inFlight || document.visibilityState !== "visible" ||
        Date.now() - lastAttempt < EVENT_THROTTLE_MS
      ) return;

      inFlight = true;
      lastAttempt = Date.now();
      try {
        const response = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
        });
        if (!disposed && response.status === 401) {
          expired = true;
          router.refresh();
        }
      } catch {
        // Preserve the session on transient failures; retry on later activity.
      } finally {
        inFlight = false;
      }
    }

    void renew();
    const interval = window.setInterval(renew, RENEW_INTERVAL_MS);
    document.addEventListener("visibilitychange", renew);
    window.addEventListener("online", renew);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", renew);
      window.removeEventListener("online", renew);
    };
  }, [active, router]);

  return null;
}
