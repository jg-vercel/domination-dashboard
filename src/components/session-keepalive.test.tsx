import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionKeepalive } from "./session-keepalive";

describe("SessionKeepalive", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renews an active session once with same-origin credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionKeepalive active />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
    });
  });

  it("does not call the server without a resolved session", () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionKeepalive active={false} />);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
