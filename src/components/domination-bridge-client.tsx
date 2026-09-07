"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type BridgeState =
  | { status: "connecting"; message: string }
  | { status: "error"; message: string };

export function DominationBridgeClient({
  csrfToken,
}: {
  csrfToken: string | null;
}) {
  const started = useRef(false);
  const [state, setState] = useState<BridgeState>(
    csrfToken
      ? {
          status: "connecting",
          message: "공식 로그인 정보를 미국 서버에 안전하게 연결하고 있습니다…",
        }
      : {
          status: "error",
          message: "먼저 대시보드에서 Google 로그인을 완료한 뒤 다시 연결해 주세요.",
        },
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");
    window.history.replaceState(null, "", "/auth/domination-bridge");

    if (!csrfToken) {
      return;
    }
    if (!token) {
      queueMicrotask(() => {
        setState({
          status: "error",
          message: "공식 로그인 정보를 찾지 못했습니다. 대시보드의 연결 절차를 다시 진행해 주세요.",
        });
      });
      return;
    }

    void connect(token, csrfToken).then((result) => {
      if (result.ok) {
        window.location.replace("/?dominations=connected");
        return;
      }
      setState({ status: "error", message: bridgeErrorMessage(result.code) });
    });
  }, [csrfToken]);

  return (
    <main className="bridge-page">
      <section className="bridge-card" aria-live="polite">
        <span className={`bridge-state-icon ${state.status}`} aria-hidden="true">
          {state.status === "connecting" ? "↻" : "!"}
        </span>
        <p className="eyebrow">DOMINATIONS SESSION BRIDGE</p>
        <h1>{state.status === "connecting" ? "계정 연결 중" : "연결 확인 필요"}</h1>
        <p>{state.message}</p>
        {state.status === "error" ? (
          <Link className="primary-button bridge-return" href="/">
            대시보드로 돌아가기 <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </section>
    </main>
  );
}

async function connect(
  xsollaToken: string,
  csrfToken: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const response = await fetch("/api/auth/dominations/bridge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-CSRF": csrfToken,
      },
      body: JSON.stringify({ xsollaToken }),
      cache: "no-store",
    });
    const payload: unknown = await response.json();
    if (response.ok && isSuccess(payload)) return { ok: true };
    return { ok: false, code: readErrorCode(payload) };
  } catch {
    return { ok: false, code: "BRIDGE_FAILED_SAFELY" };
  }
}

function isSuccess(value: unknown): value is { ok: true } {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (value as Record<string, unknown>).ok === true;
}

function readErrorCode(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "BRIDGE_FAILED_SAFELY";
  }
  const error = (value as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return "BRIDGE_FAILED_SAFELY";
  }
  return typeof (error as Record<string, unknown>).code === "string"
    ? String((error as Record<string, unknown>).code)
    : "BRIDGE_FAILED_SAFELY";
}

function bridgeErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "대시보드 로그인이 만료되었습니다. Google 로그인 후 다시 연결해 주세요.",
    BRIDGE_TOKEN_INVALID: "공식 로그인 정보 형식이 올바르지 않습니다. 공식 상점에 다시 로그인해 주세요.",
    BRIDGE_TOKEN_REJECTED: "공식 로그인이 만료되었거나 거부되었습니다. 공식 상점에서 다시 로그인해 주세요.",
    ACCOUNT_DIRECTORY_INVALID: "게임 계정 목록을 확인하지 못했습니다. 계정 연결을 다시 시도해 주세요.",
    SESSION_STORE_UNAVAILABLE: "세션 저장소에 잠시 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  };
  return messages[code] ?? "안전하게 연결을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
