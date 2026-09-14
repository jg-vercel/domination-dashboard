import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionKeepalive } from "./session-keepalive";

const { refresh, router } = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, router: { refresh } };
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("SessionKeepalive", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  it("renews on visible activity, throttles events and cleans up listeners", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<SessionKeepalive active />);
    await act(async () => {});
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("hidden");
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    window.dispatchEvent(new Event("online"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("preserves sessions on temporary errors and stops after confirmed expiration", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionKeepalive active />);
    await act(async () => {});
    expect(refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(refresh).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not overlap requests or refresh the UI after unmount", async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(
      new Promise<Response>((resolve) => { finish = resolve; }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<SessionKeepalive active />);
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(fetchMock).toHaveBeenCalledOnce();
    unmount();
    await act(async () => finish(new Response(null, { status: 401 })));
    expect(refresh).not.toHaveBeenCalled();
  });
});
