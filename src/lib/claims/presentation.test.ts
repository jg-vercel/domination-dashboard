import { describe, expect, it } from "vitest";

import { CLAIM_ACTION_NOTICE, CLAIM_RETRY_GUIDANCE, CLAIM_WAIT_GUIDANCE, RECOVERED_CLAIM_LABEL, REPLAYED_CLAIM_LABEL, claimReasonLabel, claimStatusLabel } from "./presentation";

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
    "FREE_PURCHASE_ACCEPTED", "PURCHASE_RESPONSE_UNCONFIRMED", "LEGACY_RECOVERY_UNAVAILABLE",
    "STORE_RATE_LIMITED", "BATCH_TIME_BUDGET",
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
    expect(CLAIM_RETRY_GUIDANCE).toContain("이번 요청의 결과가 불명확하면 추가 전송을 보류");
    expect(CLAIM_ACTION_NOTICE).toContain("기존 결과 미확인 계정은 상점의 최신 상태를 확인한 뒤 필요한 경우 1회 재시도");
    expect(CLAIM_ACTION_NOTICE).toContain("이미 성공한 계정은 제외");
    expect(CLAIM_ACTION_NOTICE).toContain("상점 한도");
    expect(RECOVERED_CLAIM_LABEL).toBe("이전 미확인 요청 재처리");
  });

  it("distinguishes an official free success response from uncertain or unavailable recovery", () => {
    expect(claimReasonLabel("FREE_PURCHASE_ACCEPTED")).toContain("무료 수령 성공 응답을 확인");
    expect(claimReasonLabel("FREE_PURCHASE_ACCEPTED")).toContain("게임 반영까지 시간이 걸릴 수");
    expect(claimReasonLabel("PURCHASE_RESPONSE_UNCONFIRMED")).toContain("추가 전송을 보류");
    expect(claimReasonLabel("LEGACY_RECOVERY_UNAVAILABLE")).toContain("요청을 보내지 않았습니다");
  });

  it("explains rate-limit waiting and unattempted work without promising successful collection", () => {
    expect(CLAIM_WAIT_GUIDANCE).toBe("상점 요청 제한을 지키며 순차 처리합니다. 대기 중에는 다시 누르지 마세요.");
    expect(claimReasonLabel("STORE_RATE_LIMITED")).toContain("요청 빈도 제한");
    expect(claimReasonLabel("STORE_RATE_LIMITED")).toContain("잠시 기다린 뒤 버튼을 눌러 다시 시도");
    expect(claimReasonLabel("BATCH_TIME_BUDGET")).toContain("이번 차례의 구매 요청은 보내지 않았습니다");
    expect(claimReasonLabel("BATCH_TIME_BUDGET")).toContain("성공한 결과는 유지");
  });

  it("does not call a legacy unverified token a confirmed paid checkout", () => {
    expect(claimReasonLabel("PAID_TOKEN_REJECTED")).toBe("무료 수령 응답을 확인하지 못해 재전송을 보류했습니다.");
    expect(claimReasonLabel("PAID_TOKEN_REJECTED")).not.toMatch(/유료|결제/);
  });

  it.each(["private-token-or-upstream-message", "constructor", "toString", "__proto__", ""])("does not display unknown reason text %j", (reason) => {
    expect(claimReasonLabel(reason)).toBe("수령 결과를 확인해 주세요.");
  });
});
