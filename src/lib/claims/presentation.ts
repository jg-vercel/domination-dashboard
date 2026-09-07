import type { ClaimResultStatus } from "./service";

export const REPLAYED_CLAIM_LABEL = "이전 기록 · 재전송하지 않음";
export const CLAIM_RETRY_GUIDANCE =
  "성공·한도 도달·결과 미확인 요청은 다시 보내지 않습니다. 재시도 가능한 실패만 버튼을 눌러 다시 확인합니다.";

const statusLabels: Record<ClaimResultStatus, string> = {
  success: "수령 성공",
  already_claimed: "이미 수령",
  duplicate: "중복 차단",
  ineligible: "수령 불가",
  failed: "실패",
  uncertain: "직접 확인 필요",
};

const reasonLabels: Readonly<Record<string, string>> = {
  CONFIRMED: "상점의 수령 결과를 확인했습니다.",
  ALREADY_CLAIMED: "상점에서 이미 수령한 상태로 확인했습니다.",
  PREVIOUS_RESULT: "저장된 처리 기록이 있어 재전송하지 않았습니다.",
  ACCOUNT_IN_PROGRESS: "이 계정의 요청이 처리 중이거나 결과 확인을 기다리고 있어 재전송하지 않았습니다.",
  ITEM_MISSING: "상점 목록에서 대상 무료 상품을 찾지 못했습니다.",
  ITEM_NOT_VERIFIED: "무료 상품 여부 또는 구매 조건을 확인하지 못했습니다.",
  ITEM_NOT_AVAILABLE: "상점에서 현재 수령할 수 없는 상태입니다.",
  PAID_TOKEN_REJECTED: "무료 수령 응답을 확인하지 못해 재전송을 보류했습니다.",
  UPSTREAM_BEFORE_PURCHASE: "구매 요청 전 상점 확인에 실패했습니다. 버튼을 눌러 다시 확인할 수 있습니다.",
  POST_PURCHASE_UNCONFIRMED: "요청 후 수령 결과를 확인하지 못해 재전송을 보류했습니다.",
  STORE_PURCHASE_REJECTED: "상점이 수령 요청을 거절했습니다. 버튼을 눌러 다시 시도할 수 있습니다.",
  STORE_PURCHASE_LIMIT: "상점의 수령 한도에 도달해 재전송을 보류했습니다.",
  STORE_ITEM_UNAVAILABLE: "상점이 해당 상품의 수령을 허용하지 않았습니다. 버튼을 눌러 다시 확인할 수 있습니다.",
  PREVIOUS_OUTCOME_UNKNOWN: "이전 기록만으로 수령 결과를 확인할 수 없어 재전송하지 않았습니다.",
};

export function claimStatusLabel(status: ClaimResultStatus): string {
  return statusLabels[status];
}

export function claimReasonLabel(reason: string): string {
  // Do not render raw, unrecognized upstream/server strings in the dashboard.
  return Object.hasOwn(reasonLabels, reason)
    ? reasonLabels[reason]
    : "수령 결과를 확인해 주세요.";
}
