import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClaimAllButton } from "./claim-all-button";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

describe("ClaimAllButton", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    refreshMock.mockReset();
  });

  it("keeps the action disabled when server safety checks are incomplete", () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ClaimAllButton
        enabled={false}
        csrfToken={null}
        disabledReason="중복 방지 설정이 필요합니다."
      />,
    );

    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText("중복 방지 설정이 필요합니다.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires confirmation and sends the session CSRF header", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ok: true,
        cycle: { id: "2026-08-28" },
        auditRecorded: true,
        results: [
          {
            accountName: "Commander 1",
            maskedAccountId: "••••0001",
            status: "success",
            reason: "CONFIRMED",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(
      <ClaimAllButton
        enabled
        csrfToken="csrf-token"
        disabledReason="버튼을 누를 때만 실행합니다."
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "모든 계정에서 무료 토큰 수령" }),
    );

    expect(await screen.findByText("수령 성공")).toBeInTheDocument();
    expect(screen.getByText("Commander 1 · ••••0001")).toBeInTheDocument();
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("/api/claims/free-legendary-token");
    expect(new Headers(request?.[1]?.headers).get("X-Claim-CSRF")).toBe(
      "csrf-token",
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
  });

  it("warns against retry when the result cannot be confirmed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 502 })),
    );
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(
      <ClaimAllButton
        enabled
        csrfToken="csrf-token"
        disabledReason="ready"
      />,
    );
    fireEvent.click(screen.getByRole("button"));

    expect(
      await screen.findByText(
        "수령을 확정하지 못했습니다. 결과를 확인하기 전 다시 누르지 마세요.",
      ),
    ).toHaveAttribute("role", "alert");
  });
});
