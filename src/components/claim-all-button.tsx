"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import {
  CLAIM_ACTION_NOTICE,
  CLAIM_RETRY_GUIDANCE,
  RECOVERED_CLAIM_LABEL,
  REPLAYED_CLAIM_LABEL,
  claimReasonLabel,
  claimStatusLabel,
} from "@/lib/claims/presentation";

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
  replayed?: true;
  recovered?: true;
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
  | { status: "complete"; response: ClaimResponse }
  | { status: "error"; message: string };

export function ClaimAllButton({
  enabled,
  accountCount,
  csrfToken,
  disabledReason,
  buttonLabel = "전체 계정 무료 토큰 수령",
}: {
  enabled: boolean;
  accountCount: number;
  csrfToken: string | null;
  disabledReason: string;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<ButtonState>({ status: "idle" });
  const requestInFlight = useRef(false);
  const noticeId = useId();

  async function claimAll() {
    if (!enabled || accountCount < 1 || !csrfToken || requestInFlight.current) return;
    requestInFlight.current = true;
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/claims/free-legendary-token", {
        method: "POST",
        headers: { "X-Claim-CSRF": csrfToken },
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isClaimResponse(payload)) {
        const code = readErrorCode(payload);
        if (code === "DOMINATIONS_SESSION_REQUIRED") {
          setState({
            status: "error",
            message: "DomiNations 공식 로그인 세션이 만료되었습니다. 위 연결 절차를 다시 진행해 주세요.",
          });
          router.refresh();
          return;
        }
        throw new Error("claim failed");
      }

      setState({ status: "complete", response: payload });
      router.refresh();
    } catch {
      setState({
        status: "error",
        message:
          "수령을 확정하지 못했습니다. 결과를 확인하기 전 다시 누르지 마세요.",
      });
    } finally {
      requestInFlight.current = false;
    }
  }

  return (
    <div className="claim-control">
      <button
        className={enabled ? "claim-button" : "disabled-button"}
        type="button"
        disabled={!enabled || accountCount < 1 || state.status === "loading"}
        onClick={claimAll}
        aria-describedby={noticeId}
      >
        {state.status === "loading"
          ? `${accountCount}개 계정 순차 확인 중…`
          : buttonLabel}
        {enabled && state.status !== "loading" ? <span aria-hidden="true">→</span> : null}
      </button>

      <p className="button-hint" id={noticeId}>{CLAIM_ACTION_NOTICE}</p>
      {state.status === "idle" && <p className="button-hint">{disabledReason}</p>}
      {state.status === "error" && (
        <p className="claim-error" role="alert">{state.message}</p>
      )}
      {state.status === "complete" && (
        <div className="claim-results" role="status">
          <p>Cycle {state.response.cycle.id} 처리 결과</p>
          {state.response.results.map((result, index) => (
            <div key={`${result.maskedAccountId}-${index}`}>
              <div className="claim-result-row">
                <span>{result.accountName} · {result.maskedAccountId}</span>
                <strong className={`claim-${result.status}`}>
                  {claimStatusLabel(result.status)}
                </strong>
              </div>
              <p className="button-hint">{claimReasonLabel(result.reason)}</p>
              {result.replayed && <p className="audit-warning">{REPLAYED_CLAIM_LABEL}</p>}
              {result.recovered && <p className="audit-warning">{RECOVERED_CLAIM_LABEL}</p>}
            </div>
          ))}
          <p className="audit-warning">{CLAIM_RETRY_GUIDANCE}</p>
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

function readErrorCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) return null;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
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
        typeof result.reason === "string" &&
        (result.replayed === undefined || result.replayed === true) &&
        (result.recovered === undefined || result.recovered === true) &&
        claimStatuses.includes(result.status as ClaimStatus),
    )
  );
}
