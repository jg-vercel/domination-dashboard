"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ConnectionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; code: string; stage?: string };

export function DominationLinkPanel({
  bridgeUrl,
  csrfToken,
  connected,
}: {
  bridgeUrl: string | null;
  csrfToken: string | null;
  connected: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<ConnectionState>({ status: "idle" });
  const authenticated = csrfToken !== null;

  async function connectAccount() {
    if (!csrfToken || state.status === "loading") return;
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/auth/dominations/connect", {
        method: "POST",
        headers: { "X-Connect-CSRF": csrfToken },
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      if (
        response.ok &&
        isRecord(payload) &&
        payload.ok === true &&
        payload.accountCount === 3
      ) {
        window.location.replace("/?dominations=connected#accounts");
        return;
      }
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
      setState({
        status: "error",
        code: typeof error?.code === "string" ? error.code : "UPSTREAM_UNAVAILABLE",
        stage: typeof error?.stage === "string" ? error.stage : undefined,
      });
      router.refresh();
    } catch {
      setState({ status: "error", code: "UPSTREAM_UNAVAILABLE" });
    }
  }

  return (
    <section
      className={`link-panel ${connected ? "is-connected" : ""}`}
      id="domi-connect"
      aria-labelledby="domi-connect-title"
    >
      <div className="link-panel-heading">
        <div>
          <p className="eyebrow">GAME ACCOUNT CONNECTION</p>
          <h2 id="domi-connect-title">Domi 연결</h2>
        </div>
        <span className={`card-status ${connected ? "success" : "pending"}`}>
          {connected
            ? "계정 연결됨"
            : !bridgeUrl
              ? "설정 확인 필요"
              : authenticated
                ? "상점 연결 필요"
                : "Google 로그인 필요"}
        </span>
      </div>

      <p className="link-panel-copy">
        {connected
          ? "게임 계정이 연결되었습니다. 아래 계정 목록에서 무료 토큰 상태를 확인하고 수령해 주세요."
          : "Google 로그인 후 해당 계정의 상점 인증을 서버에서 연결합니다. 수령 요청은 미국 서버에서 실행됩니다."}
      </p>

      {!bridgeUrl ? (
        <div className="link-login-prompt">
          <p>이 주소에서는 로그인 설정이 준비되지 않았습니다. 안내받은 대시보드 주소를 확인해 주세요.</p>
        </div>
      ) : !authenticated ? (
        <div className="link-login-prompt">
          <p>수령할 게임 계정과 연결된 Google 계정으로 로그인해 주세요.</p>
          <a
            className="primary-button link-google-login"
            href={`${bridgeUrl}/api/auth/google/start`}
          >
            Google 로그인
          </a>
        </div>
      ) : (
        <div className="link-direct-actions">
          <button
            className="primary-button"
            type="button"
            onClick={connectAccount}
            disabled={state.status === "loading"}
          >
            {state.status === "loading"
              ? "상점 계정 확인 중…"
              : connected
                ? "계정 연결 새로고침"
                : "Domi 연결"}
          </button>
          <a className="secondary-button" href={`${bridgeUrl}/api/auth/google/start`}>
            Google 다시 로그인
          </a>
        </div>
      )}

      {state.status === "error" && (
        <p className="claim-error" role="alert">
          {connectionErrorMessage(state.code, state.stage)}
        </p>
      )}
      <p className="link-security-note" role="status">
        {state.status === "loading"
          ? "Google 인증과 게임 계정 3개를 확인하고 있습니다."
          : "계정 연결은 아이템을 수령하지 않습니다. 수령은 아래 버튼을 누를 때만 진행됩니다."}
      </p>
    </section>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function connectionErrorMessage(code: string, stage?: string): string {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "대시보드 로그인이 만료되었습니다. Google 다시 로그인을 눌러 주세요.",
    GOOGLE_REFRESH_REJECTED: "Google 인증을 갱신할 수 없습니다. Google 다시 로그인을 눌러 주세요.",
    GOOGLE_REFRESH_TOKEN_MISSING: "Google 인증을 갱신할 수 없습니다. Google 다시 로그인을 눌러 주세요.",
    XSOLLA_GOOGLE_TOKEN_REJECTED: "상점 인증 서비스에서 Google 인증을 거부했습니다. 연결 요청을 확인해야 합니다.",
    DOMINATIONS_SIGNUP_REJECTED: "DomiNations 로그인 응답을 확인하지 못했습니다. 연결 요청을 확인해야 합니다.",
    DOMINATIONS_TOKEN_REJECTED: "DomiNations 상점 토큰을 발급받지 못했습니다. 연결 요청을 확인해야 합니다.",
    DOMINATIONS_SESSION_REQUIRED: "상점에서 인증을 인정하지 않았습니다. 대시보드 로그인은 유지됩니다. Domi 연결을 다시 눌러 주세요.",
    ACCOUNT_COUNT_MISMATCH: "이 Google 계정에 연결된 게임 계정이 정확히 3개인지 확인해 주세요.",
    SESSION_STORE_UNAVAILABLE: "로그인 저장소에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    SESSION_TOO_LARGE: "상점 인증 정보를 저장하지 못했습니다. 연결 요청을 확인해야 합니다.",
    CSRF_REJECTED: "연결 확인 정보가 갱신되었습니다. 페이지를 새로고침한 뒤 다시 눌러 주세요.",
    ORIGIN_REJECTED: "대시보드의 공식 Preview 주소에서 다시 연결해 주세요.",
  };
  if (code === "UPSTREAM_UNAVAILABLE" && stage) {
    const stages: Record<string, string> = {
      google_refresh: "Google 인증 갱신",
      xsolla_google_token: "상점 Google 인증",
      dominations_signup: "DomiNations 로그인 시작",
      dominations_token: "DomiNations 토큰 발급",
      game_account_list: "게임 계정 목록 조회",
      linked_accounts: "게임 계정 상세 조회",
    };
    if (stages[stage]) {
      return `${stages[stage]} 단계에서 연결에 실패했습니다. 대시보드 로그인은 유지됩니다.`;
    }
  }
  return messages[code] ?? "상점 연결을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
