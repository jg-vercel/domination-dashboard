"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ClaimStatus =
  | "success"
  | "already_claimed"
  | "duplicate"
  | "ineligible"
  | "failed"
  | "uncertain";

interface ClaimResult {
  accountName: string;
  maskedAccountId: string;
  status: ClaimStatus;
  reason: string;
}

interface ClaimResponse {
  ok: true;
  cycle: { id: string };
  results: ClaimResult[];
  auditRecorded: boolean;
}

const claimStatuses: ClaimStatus[] = [
  "success",
  "already_claimed",
  "duplicate",
  "ineligible",
  "failed",
  "uncertain",
];

type ButtonState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; response: ClaimResponse }
  | { status: "error"; message: string };

export function ClaimAllButton({
  enabled,
  csrfToken,
  disabledReason,
  buttonLabel = "모든 계정에서 무료 토큰 수령",
}: {
  enabled: boolean;
  csrfToken: string | null;
  disabledReason: string;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<ButtonState>({ status: "idle" });

  async function claimAll() {
    if (!enabled || !csrfToken) return;
    if (
      !window.confirm(
        "연결된 게임 계정 3개에서 무료 Legendary Token 수령을 시작할까요?",
      )
    ) {
      return;
    }

    setState({ status: "loading" });
    try {
      const response = await fetch("/api/claims/free-legendary-token", {
        method: "POST",
        headers: { "X-Claim-CSRF": csrfToken },
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isClaimResponse(payload)) {
        throw new Error("claim failed");
      }

      setState({ status: "success", response: payload });
      router.refresh();
    } catch {
      setState({
        status: "error",
        message:
          "수령을 확정하지 못했습니다. 결과를 확인하기 전 다시 누르지 마세요.",
      });
    }
  }

  return (
    <div className="claim-control">
      <button
        className={enabled ? "claim-button" : "disabled-button"}
        type="button"
        disabled={!enabled || state.status === "loading"}
        onClick={claimAll}
      >
        {state.status === "loading"
          ? "3개 계정 순차 확인 중…"
          : state.status === "success"
            ? "실패·미수령 계정 다시 확인"
            : buttonLabel}
        {enabled && state.status !== "loading" ? <span aria-hidden="true">→</span> : null}
      </button>

      {state.status === "idle" && <p className="button-hint">{disabledReason}</p>}
      {state.status === "error" && (
        <p className="claim-error" role="alert">{state.message}</p>
      )}
      {state.status === "success" && (
        <div className="claim-results" role="status">
          <p>Cycle {state.response.cycle.id} 결과</p>
          {state.response.results.map((result) => (
            <div className="claim-result-row" key={result.maskedAccountId}>
              <span>{result.accountName} · {result.maskedAccountId}</span>
              <strong className={`claim-${result.status}`}>
                {statusLabel(result.status)}
              </strong>
            </div>
          ))}
          {!state.response.auditRecorded && (
            <p className="audit-warning">
              결과는 표시됐지만 감사 기록 저장을 확인하지 못했습니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function isClaimResponse(value: unknown): value is ClaimResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const response = value as Partial<ClaimResponse>;
  return (
    response.ok === true &&
    typeof response.cycle?.id === "string" &&
    typeof response.auditRecorded === "boolean" &&
    Array.isArray(response.results) &&
    response.results.every(
      (result) =>
        typeof result === "object" &&
        result !== null &&
        typeof result.accountName === "string" &&
        typeof result.maskedAccountId === "string" &&
        typeof result.status === "string" &&
        claimStatuses.includes(result.status as ClaimStatus),
    )
  );
}

function statusLabel(status: ClaimStatus): string {
  return {
    success: "수령 성공",
    already_claimed: "이미 수령",
    duplicate: "중복 차단",
    ineligible: "수령 불가",
    failed: "실패",
    uncertain: "직접 확인 필요",
  }[status];
}
