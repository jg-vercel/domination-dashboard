import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SystemDiagnostics } from "./system-diagnostics";

describe("SystemDiagnostics", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("runs both server diagnostics and renders their allowlisted results", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          runtime: {
            configuredRegion: "iad1",
            runtimeRegion: "iad1",
            regionMatches: true,
            platform: "vercel",
            nodeVersion: "24.4.0",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          network: {
            countryCode: "US",
            asia: false,
            apiEnabled: true,
            targetCountryCode: "US",
            targetMet: true,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<SystemDiagnostics />);
    fireEvent.click(screen.getByRole("button", { name: "환경 진단 실행" }));

    await waitFor(() => {
      expect(screen.getByText("iad1")).toBeInTheDocument();
      expect(screen.getByText("US")).toBeInTheDocument();
      expect(screen.getByText("READY")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a safe error without exposing response details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 502 })),
    );

    render(<SystemDiagnostics />);
    fireEvent.click(screen.getByRole("button", { name: "환경 진단 실행" }));

    expect(
      await screen.findByText(
        "진단을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      ),
    ).toHaveAttribute("role", "alert");
  });
});
