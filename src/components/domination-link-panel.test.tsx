import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DominationLinkPanel } from "./domination-link-panel";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

describe("DominationLinkPanel connection errors", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    refreshMock.mockReset();
  });

  it.each([
    ["google_refresh", "Google 인증 갱신"],
    ["xsolla_google_token", "상점 Google 인증"],
    ["dominations_signup", "DomiNations 로그인 시작"],
    ["dominations_token", "DomiNations 토큰 발급"],
    ["game_account_list", "게임 계정 목록 조회"],
    ["linked_accounts", "게임 계정 상세 조회"],
  ])("explains the %s failure stage without submitting a purchase", async (stage, label) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: false,
      error: { code: "UPSTREAM_UNAVAILABLE", stage },
    }, { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<DominationLinkPanel bridgeUrl="https://dashboard.example" csrfToken="test-csrf" connected={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Domi 연결" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(`${label} 단계에서 연결에 실패했습니다.`);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/auth/dominations/connect", {
      method: "POST",
      headers: { "X-Connect-CSRF": "test-csrf" },
      cache: "no-store",
    });
    expect(screen.getByRole("link", { name: "Google 다시 로그인" })).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("does not display an unrecognized upstream stage or message", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: false,
      error: { code: "UPSTREAM_UNAVAILABLE", stage: "private-token", message: "private-token" },
    }, { status: 502 })));

    render(<DominationLinkPanel bridgeUrl="https://dashboard.example" csrfToken="test-csrf" connected={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Domi 연결" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("상점 연결을 완료하지 못했습니다.");
    expect(screen.queryByText(/private-token/)).not.toBeInTheDocument();
  });
});
