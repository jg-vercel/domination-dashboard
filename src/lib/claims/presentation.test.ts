import { describe, expect, it } from "vitest";

import { CLAIM_RETRY_GUIDANCE, REPLAYED_CLAIM_LABEL, claimReasonLabel, claimStatusLabel } from "./presentation";

describe("claim result presentation", () => {
  it.each([
    ["success", "수령 성공"], ["already_claimed", "이미 수령"], ["duplicate", "중복 차단"],
    ["ineligible", "수령 불가"], ["failed", "실패"], ["uncertain", "직접 확인 필요"],
  ] as const)("labels %s without flattening previous outcomes", (status, label) => {
    expect(claimStatusLabel(status)).toBe(label);
  });

  it.each([
    "CONFIRMED", "ALREADY_CLAIMED", "PREVIOUS_RESULT", "ACCOUNT_IN_PROGRESS", "ITEM_MISSING",
    "ITEM_NOT_VERIFIED", "ITEM_NOT_AVAILABLE", "PAID_TOKEN_REJECTED", "UPSTREAM_BEFORE_PURCHASE",
    "POST_PURCHASE_UNCONFIRMED", "STORE_PURCHASE_REJECTED", "STORE_PURCHASE_LIMIT",
    "STORE_ITEM_UNAVAILABLE", "PREVIOUS_OUTCOME_UNKNOWN",
  ])("provides a Korean explanation for %s", (reason) => {
    expect(claimReasonLabel(reason)).toMatch(/[가-힣]/);
    expect(claimReasonLabel(reason)).not.toBe("수령 결과를 확인해 주세요.");
  });

  it("distinguishes manual retries from blocked or unknown outcomes", () => {
    expect(claimReasonLabel("STORE_PURCHASE_REJECTED")).toContain("버튼을 눌러 다시 시도");
    expect(claimReasonLabel("STORE_ITEM_UNAVAILABLE")).toContain("버튼을 눌러 다시 확인");
    expect(claimReasonLabel("STORE_PURCHASE_LIMIT")).toContain("한도에 도달해 재전송을 보류");
    expect(claimReasonLabel("PREVIOUS_OUTCOME_UNKNOWN")).toContain("확인할 수 없어 재전송하지 않았습니다");
    expect(REPLAYED_CLAIM_LABEL).toBe("이전 기록 · 재전송하지 않음");
    expect(CLAIM_RETRY_GUIDANCE).toContain("결과 미확인 요청은 다시 보내지 않습니다");
  });

  it("does not call a legacy unverified token a confirmed paid checkout", () => {
    expect(claimReasonLabel("PAID_TOKEN_REJECTED")).toBe("무료 수령 응답을 확인하지 못해 재전송을 보류했습니다.");
    expect(claimReasonLabel("PAID_TOKEN_REJECTED")).not.toMatch(/유료|결제/);
  });

  it.each(["private-token-or-upstream-message", "constructor", "toString", "__proto__", ""])("does not display unknown reason text %j", (reason) => {
    expect(claimReasonLabel(reason)).toBe("수령 결과를 확인해 주세요.");
  });
});
