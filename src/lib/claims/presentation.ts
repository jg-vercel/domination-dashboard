import type { ClaimResultStatus } from "./service";

export const REPLAYED_CLAIM_LABEL = "이전 기록 · 재전송하지 않음";
export const RECOVERED_CLAIM_LABEL = "이전 미확인 요청 재처리";
export const CLAIM_ACTION_NOTICE =
  "한 번 누르면 이미 성공한 계정은 제외하고, 기존 결과 미확인 계정은 상점의 최신 상태를 확인한 뒤 필요한 경우 1회 재시도합니다. 수령 가능 여부는 상점 한도를 따릅니다.";
export const CLAIM_RETRY_GUIDANCE =
  "이번 요청의 결과가 불명확하면 추가 전송을 보류합니다. 이미 성공한 계정은 다시 요청하지 않으며, 수령 여부는 상점 한도를 따릅니다.";
export const CLAIM_WAIT_GUIDANCE =
  "상점 요청 제한을 지키며 순차 처리합니다. 대기 중에는 다시 누르지 마세요.";

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
  FREE_PURCHASE_ACCEPTED: "상점의 무료 수령 성공 응답을 확인했습니다. 게임 반영까지 시간이 걸릴 수 있습니다.",
  PURCHASE_RESPONSE_UNCONFIRMED: "이번 요청의 결과를 확인하지 못해 추가 전송을 보류했습니다.",
  LEGACY_RECOVERY_UNAVAILABLE: "이전 기록은 미확인 상태이며, 현재 수령 가능한 상품을 확인하지 못해 요청을 보내지 않았습니다.",
  STORE_RATE_LIMITED: "상점의 요청 빈도 제한으로 수령 요청을 완료하지 못했습니다. 잠시 기다린 뒤 버튼을 눌러 다시 시도할 수 있습니다.",
  BATCH_TIME_BUDGET: "안전한 실행 시간 안에 처리하지 못해 이번 차례의 구매 요청은 보내지 않았습니다. 성공한 결과는 유지되며 버튼을 눌러 다시 시도할 수 있습니다.",
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
