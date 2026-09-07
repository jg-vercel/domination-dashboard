import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardAccount } from "@/lib/dashboard/snapshot";
import { AccountStoreDiagnostics } from "./account-store-diagnostics";

const account: DashboardAccount = {
  maskedId: "••••0001", name: "Unknown commander", age: null, trophies: null,
  catalog: {
    productCount: 1, namedProductCount: 1, webSpecialsCount: 1, freeProductCount: 1,
    purchasableSkuCount: 1, disabledProductCount: 0, exactTargetNameCount: 1,
    whitespaceFoldedTargetNameCount: 1, webSpecials: [], webSpecialsTruncated: false,
  },
  product: { state: "available", sectionVerified: true, isFree: true, stockAvailable: 0, stockMax: 0, refreshSeconds: 3600 },
  diagnostics: {
    directorySource: "listed_only", profileNamePresent: false, profileFieldsPresent: false, profileErrorShape: true,
    exactTargetCandidateCount: 2, distinctSkuOfferCandidateCount: 2,
    selected: {
      stockAvailable: 0, stockMax: 0, refreshSeconds: 3600,
      disabled: false, locked: false, noInventory: false, isFree: true,
      sectionVerified: true, skuPresent: true, offerIdPresent: false, stockGuardConflict: true,
    },
  },
};

describe("AccountStoreDiagnostics", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows diagnostics even for an available account and never sends a purchase when opened", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<AccountStoreDiagnostics account={account} />);
    const summary = screen.getByText("계정·상품 진단 (구매 없음)");

    expect(summary.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(summary);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector("button, form, a")).toBeNull();
    expect(screen.getByText(/수령 성공을 증명하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText("계정 ID 목록에만 있음")).toBeInTheDocument();
    expect(screen.getByText(/잘못된 게임 계정이라고 판단하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/현재는 상점 응답의 첫 후보를 사용/)).toBeInTheDocument();
    expect(screen.getByText(/남은 재고가 0 이하인데/)).toBeInTheDocument();
    expect(screen.getByText("3600초")).toBeInTheDocument();
    expect(screen.getByText(/빈 offer ID만으로 수령 불가를 뜻하지는 않습니다/)).toBeInTheDocument();
  });

  it.each([
    ["both", "두 계정 목록 모두에 있음"],
    ["linked_only", "연결 계정 목록에만 있음"],
    [null, "확인되지 않음"],
  ] as const)("renders safe labels for directory source %s", (directorySource, label) => {
    render(<AccountStoreDiagnostics account={{ ...account, diagnostics: { ...account.diagnostics!, directorySource } }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("distinguishes no target from missing diagnostics without inferring a bad account", () => {
    const { rerender } = render(<AccountStoreDiagnostics account={{ ...account, diagnostics: { ...account.diagnostics!, exactTargetCandidateCount: 0, distinctSkuOfferCandidateCount: 0, selected: null } }} />);
    expect(screen.getByText("정확한 상품명에 해당하는 선택 후보가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText("현재 선택된 상품의 조회 값")).not.toBeInTheDocument();
    expect(screen.queryByText(/공식 상점의 클릭 조건과 차이/)).not.toBeInTheDocument();

    rerender(<AccountStoreDiagnostics account={{ ...account, diagnostics: undefined }} />);
    expect(screen.getByText(/이번 조회에는 진단 정보가 없습니다/)).toBeInTheDocument();
  });

  it("does not expose extra raw account, error, credential, or purchase fields", () => {
    const privateAccount = {
      ...account, name: "private-name", gameAccountId: "private-account", accessToken: "private-token",
      diagnostics: {
        ...account.diagnostics!, error: "private-error", cookie: "private-cookie",
        selected: { ...account.diagnostics!.selected!, sku: "private-sku", offerId: "private-offer" },
      },
    };
    const { container } = render(<AccountStoreDiagnostics account={privateAccount} />);
    expect(container.innerHTML).not.toContain("private-");
  });
});
