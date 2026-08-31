"use client";

import { useEffect } from "react";

export function SessionKeepalive({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;

    void fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
    }).catch(() => {
      // The next navigation renders the server-owned auth state. The keepalive
      // never retries in a loop or exposes provider details to the browser.
    });
  }, [active]);

  return null;
}
