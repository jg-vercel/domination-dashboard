import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClaimAllButton } from "./claim-all-button";
import { CLAIM_ACTION_NOTICE } from "@/lib/claims/presentation";

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
        accountCount={0}
        csrfToken={null}
        disabledReason="중복 방지 설정이 필요합니다."
      />,
    );

    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText("중복 방지 설정이 필요합니다.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([1, 5])("processes all %i linked accounts with one click and the session CSRF header", async (accountCount) => {
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
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);

    render(
      <ClaimAllButton
        enabled
        accountCount={accountCount}
        csrfToken="csrf-token"
        disabledReason="버튼을 누를 때만 실행합니다."
      />,
    );
    expect(screen.getByText(CLAIM_ACTION_NOTICE)).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAccessibleDescription(CLAIM_ACTION_NOTICE);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "전체 계정 무료 토큰 수령" }),
    );

    expect(await screen.findByText("수령 성공")).toBeInTheDocument();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(screen.getByText("Commander 1 · ••••0001")).toBeInTheDocument();
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("/api/claims/free-legendary-token");
    expect(new Headers(request?.[1]?.headers).get("X-Claim-CSRF")).toBe(
      "csrf-token",
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "전체 계정 무료 토큰 수령" })).toBeInTheDocument();
  });

  it("does not send a claim for an empty account directory", () => {
    const fetchMock = vi.fn<typeof fetch>();
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);

    render(<ClaimAllButton enabled accountCount={0} csrfToken="csrf-token" disabledReason="연결된 게임 계정이 없습니다." />);
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("button")).toBeDisabled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
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
        accountCount={1}
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

  it("shows mixed HTTP 200 outcomes, safe reasons, and replayed records without automatically retrying", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true, cycle: { id: "2026-08-28" }, auditRecorded: true,
      results: [
        { accountName: "One", maskedAccountId: "••••0001", status: "success", reason: "CONFIRMED", replayed: true },
        { accountName: "Two", maskedAccountId: "••••0002", status: "failed", reason: "STORE_PURCHASE_REJECTED" },
        { accountName: "Three", maskedAccountId: "••••0003", status: "uncertain", reason: "PREVIOUS_OUTCOME_UNKNOWN", replayed: true },
      ],
    }));
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);
    render(<ClaimAllButton enabled accountCount={3} csrfToken="csrf" disabledReason="ready" />);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button"));

    expect(await screen.findByText("Cycle 2026-08-28 처리 결과")).toBeInTheDocument();
    expect(screen.getByText("수령 성공")).toBeInTheDocument();
    expect(screen.getByText("실패")).toBeInTheDocument();
    expect(screen.getByText("직접 확인 필요")).toBeInTheDocument();
    expect(screen.getAllByText("이전 기록 · 재전송하지 않음")).toHaveLength(2);
    expect(screen.getByText("상점이 수령 요청을 거절했습니다. 버튼을 눌러 다시 시도할 수 있습니다.")).toBeInTheDocument();
    expect(screen.getByText("이전 기록만으로 수령 결과를 확인할 수 없어 재전송하지 않았습니다.")).toBeInTheDocument();
    expect(screen.queryByText("중복 차단")).not.toBeInTheDocument();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(confirmMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "전체 계정 무료 토큰 수령" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it.each([
    { reason: undefined }, { reason: 123 }, { reason: "CONFIRMED", replayed: "true" },
    { reason: "FREE_PURCHASE_ACCEPTED", recovered: "true" },
  ])("rejects malformed result fields without reporting completion: %j", async (override) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true, cycle: { id: "2026-08-28" }, auditRecorded: true,
      results: [{ accountName: "One", maskedAccountId: "••••0001", status: "success", ...override }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<ClaimAllButton enabled accountCount={1} csrfToken="csrf" disabledReason="ready" />);

    fireEvent.click(screen.getByRole("button"));

    expect(await screen.findByRole("alert")).toHaveTextContent("수령을 확정하지 못했습니다");
    expect(screen.queryByText("수령 성공")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("ignores repeat clicks while the one-click request is still running", async () => {
    let resolveRequest!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<ClaimAllButton enabled accountCount={1} csrfToken="csrf" disabledReason="ready" />);

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText(CLAIM_ACTION_NOTICE)).toBeInTheDocument();
    resolveRequest(Response.json({ ok: true, cycle: { id: "2026-08-28" }, auditRecorded: true, results: [] }));
    expect(await screen.findByText("Cycle 2026-08-28 처리 결과")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("shows recovered free acceptance separately from new uncertain outcomes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true, cycle: { id: "2026-08-28" }, auditRecorded: true,
      results: [
        { accountName: "Recovered", maskedAccountId: "••••0001", status: "success", reason: "FREE_PURCHASE_ACCEPTED", recovered: true },
        { accountName: "Uncertain", maskedAccountId: "••••0002", status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED" },
        { accountName: "Unavailable", maskedAccountId: "••••0003", status: "uncertain", reason: "LEGACY_RECOVERY_UNAVAILABLE" },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ClaimAllButton enabled accountCount={3} csrfToken="csrf" disabledReason="ready" />);

    fireEvent.click(screen.getByRole("button", { name: "전체 계정 무료 토큰 수령" }));

    expect(await screen.findByText("이전 미확인 요청 재처리")).toBeInTheDocument();
    expect(screen.getAllByText("수령 성공")).toHaveLength(1);
    expect(screen.getAllByText("직접 확인 필요")).toHaveLength(2);
    expect(screen.getByText("상점의 무료 수령 성공 응답을 확인했습니다. 게임 반영까지 시간이 걸릴 수 있습니다.")).toBeInTheDocument();
    expect(screen.getByText("이번 요청의 결과를 확인하지 못해 추가 전송을 보류했습니다.")).toBeInTheDocument();
    expect(screen.getByText("이전 기록은 미확인 상태이며, 현재 수령 가능한 상품을 확인하지 못해 요청을 보내지 않았습니다.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
