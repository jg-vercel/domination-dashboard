"use client";

import { useState } from "react";

interface RegionResponse {
  ok: true;
  runtime: {
    configuredRegion: string;
    runtimeRegion: string;
    regionMatches: boolean;
    platform: "local" | "vercel";
    nodeVersion: string;
  };
}

interface CountryResponse {
  ok: true;
  network: {
    countryCode: string;
    asia: boolean;
    apiEnabled: boolean;
    targetCountryCode: string;
    targetMet: boolean;
  };
}

type DiagnosticState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; region: RegionResponse; country: CountryResponse }
  | { status: "error"; message: string };

export function SystemDiagnostics() {
  const [state, setState] = useState<DiagnosticState>({ status: "idle" });

  async function runDiagnostics() {
    setState({ status: "loading" });

    try {
      const [regionResponse, countryResponse] = await Promise.all([
        fetch("/api/system/region", { cache: "no-store" }),
        fetch("/api/system/outbound-country", { cache: "no-store" }),
      ]);

      if (!regionResponse.ok || !countryResponse.ok) {
        throw new Error("diagnostic request failed");
      }

      const region = (await regionResponse.json()) as RegionResponse;
      const country = (await countryResponse.json()) as CountryResponse;

      if (!region.ok || !country.ok) {
        throw new Error("diagnostic response invalid");
      }

      setState({ status: "success", region, country });
    } catch {
      setState({
        status: "error",
        message: "진단을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      });
    }
  }

  return (
    <section className="diagnostic-panel" aria-labelledby="diagnostic-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">SERVER CHECK</p>
          <h2 id="diagnostic-title">미국 서버 연결 진단</h2>
        </div>
        <span className="secure-badge">읽기 전용</span>
      </div>

      <p className="panel-copy">
        Vercel Function 실행 리전과 DomiNations가 관측한 outbound 국가를
        확인합니다. 계정 로그인이나 아이템 수령은 실행하지 않습니다.
      </p>

      <button
        className="primary-button"
        type="button"
        onClick={runDiagnostics}
        disabled={state.status === "loading"}
      >
        {state.status === "loading" ? "진단 중…" : "환경 진단 실행"}
        <span aria-hidden="true">→</span>
      </button>

      {state.status === "idle" && (
        <p className="diagnostic-note" role="status">
          배포 환경의 목표값은 <strong>iad1 · US · asia=false</strong>입니다.
        </p>
      )}

      {state.status === "error" && (
        <p className="diagnostic-error" role="alert">
          {state.message}
        </p>
      )}

      {state.status === "success" && (
        <div className="diagnostic-results" role="status">
          <DiagnosticResult
            label="Function region"
            value={state.region.runtime.runtimeRegion}
            passed={
              state.region.runtime.platform === "local" ||
              state.region.runtime.regionMatches
            }
            detail={
              state.region.runtime.platform === "local"
                ? "로컬 환경"
                : "목표 iad1"
            }
          />
          <DiagnosticResult
            label="Outbound country"
            value={state.country.network.countryCode}
            passed={
              state.country.network.targetMet ||
              state.region.runtime.platform === "local"
            }
            detail={
              state.region.runtime.platform === "local"
                ? "로컬 네트워크"
                : state.country.network.targetMet
                  ? "미국 판정"
                  : "목표 불일치"
            }
          />
          <DiagnosticResult
            label="Store API"
            value={state.country.network.apiEnabled ? "READY" : "OFF"}
            passed={state.country.network.apiEnabled}
            detail={`asia=${String(state.country.network.asia)}`}
          />
        </div>
      )}
    </section>
  );
}

function DiagnosticResult({
  label,
  value,
  passed,
  detail,
}: {
  label: string;
  value: string;
  passed: boolean;
  detail: string;
}) {
  return (
    <div className="diagnostic-result">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <span className={passed ? "result-pass" : "result-fail"}>
        {passed ? "정상" : "확인 필요"} · {detail}
      </span>
    </div>
  );
}
