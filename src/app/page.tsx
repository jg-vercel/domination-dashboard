import { cookies } from "next/headers";

import { SystemDiagnostics } from "@/components/system-diagnostics";
import { ClaimAllButton } from "@/components/claim-all-button";
import { ClaimAuditList } from "@/components/claim-audit-list";
import { SessionKeepalive } from "@/components/session-keepalive";
import {
  APP_SESSION_COOKIE,
  getAuthConfig,
  getAuthReadiness,
} from "@/lib/auth/config";
import type { AuthErrorCode } from "@/lib/auth/errors";
import { asAuthError } from "@/lib/auth/errors";
import type { AppSession } from "@/lib/auth/session";
import { resolveServerAppSession } from "@/lib/auth/server-session";
import type { DashboardAccount, DashboardSnapshot } from "@/lib/dashboard/snapshot";
import { loadDashboardSnapshot } from "@/lib/dashboard/snapshot";
import { getClaimCycle } from "@/lib/claims/cycle";
import type { ClaimAuditEntry } from "@/lib/claims/audit";
import { listClaimAudits } from "@/lib/claims/audit";
import {
  createRedisClaimStore,
  getRedisReadiness,
} from "@/lib/idempotency/redis-rest";

const emptyAccountSlots = [1, 2, 3];

interface HomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const authReadiness = getAuthReadiness();
  const authErrorFromRedirect = readStringParam(params.auth_error);
  const redisReadiness = getRedisReadiness();
  const currentCycle = getClaimCycle();
  let session: AppSession | null = null;
  let snapshot: DashboardSnapshot | null = null;
  let auditEntries: ClaimAuditEntry[] = [];
  let sessionError: AuthErrorCode | null = null;

  if (authReadiness.configured && redisReadiness.configured) {
    try {
      const config = getAuthConfig();
      const cookieStore = await cookies();
      const sealedSession = cookieStore.get(APP_SESSION_COOKIE)?.value;
      if (sealedSession) {
        let resolved = await resolveServerAppSession(sealedSession, config);
        session = resolved.session;
        try {
          snapshot = await loadDashboardSnapshot(session.dominations);
        } catch (error) {
          if (asAuthError(error).code !== "SESSION_EXPIRED") throw error;
          resolved = await resolveServerAppSession(sealedSession, config, {
            forceReconnect: true,
          });
          session = resolved.session;
          snapshot = await loadDashboardSnapshot(session.dominations);
        }
      }
    } catch (error) {
      sessionError = asAuthError(error).code;
      session = null;
      snapshot = null;
    }
  }

  if (session && redisReadiness.configured) {
    auditEntries = await listClaimAudits(
      session.admin.subject,
      createRedisClaimStore(),
      10,
    ).catch(() => []);
  }

  const connectedCount = snapshot?.accountCount ?? 0;
  const claimedCount =
    snapshot?.accounts.filter((account) => account.product.state === "claimed")
      .length ?? 0;
  const authError = authErrorFromRedirect || sessionError;
  const claimEnabled = Boolean(
    session && snapshot?.ready && redisReadiness.configured,
  );
  const claimDisabledReason = !session
    ? "Google 로그인과 계정 확인이 필요합니다."
    : !snapshot?.ready
      ? "3개 계정의 exact 무료 상품 검증이 필요합니다."
      : !redisReadiness.configured
        ? "중복 방지용 Upstash Redis 설정이 필요합니다."
        : "버튼을 누를 때만 3개 계정을 순차 처리합니다.";

  return (
    <div className="app-shell">
      <SessionKeepalive active={Boolean(session)} />
      <aside className="sidebar">
        <div className="brand-mark" aria-label="Domination Daily">
          <span className="brand-icon">D</span>
          <span>
            <strong>DOMINATION</strong>
            <small>DAILY</small>
          </span>
        </div>

        <nav aria-label="대시보드 메뉴">
          <a className="nav-item nav-item-active" href="#overview">
            <span aria-hidden="true">◫</span> Overview
          </a>
          <a className="nav-item" href="#accounts">
            <span aria-hidden="true">♙</span> Game accounts
          </a>
          <a className="nav-item" href="#diagnostics">
            <span aria-hidden="true">⌁</span> Network
          </a>
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" />
          <span>
            <strong>US Function</strong>
            <small>Target · iad1</small>
          </span>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">DAILY REWARD CONTROL</p>
            <h1>오늘의 무료 보상을 준비하세요.</h1>
          </div>
          <AuthControl
            configured={authReadiness.configured && redisReadiness.configured}
            session={session}
          />
        </header>

        {authError && <AuthErrorBanner code={authError} />}

        <section className="hero-card" id="overview">
          <div className="hero-copy">
            <p className="eyebrow light">WEB SPECIALS</p>
            <h2>Free Legendary Token</h2>
            <p>
              연결된 게임 계정 3개에서 매일 한 번, 사용자 버튼으로 안전하게
              수령합니다.
            </p>
            <div className="hero-meta">
              <span>FREE</span>
              <span>매일 09:00 KST 갱신</span>
            </div>
          </div>
          <div className="token-orbit" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="token-core">L</div>
          </div>
        </section>

        <section className="stats-grid" aria-label="수령 현황">
          <article className="stat-card">
            <span className="stat-icon amber">♙</span>
            <div>
              <p>연결 계정</p>
              <strong>{connectedCount} <small>/ 3</small></strong>
            </div>
            <span className={`card-status ${connectedCount === 3 ? "success" : "pending"}`}>
              {connectedCount === 3 ? "연결됨" : "연결 전"}
            </span>
          </article>
          <article className="stat-card">
            <span className="stat-icon blue">✓</span>
            <div>
              <p>오늘 수령</p>
              <strong>{claimedCount} <small>/ 3</small></strong>
            </div>
            <span className="card-status neutral">실시간</span>
          </article>
          <article className="stat-card">
            <span className="stat-icon violet">◷</span>
            <div>
              <p>다음 갱신</p>
              <strong>09:00</strong>
            </div>
            <span className="card-status neutral">
              {currentCycle.endsAt.slice(0, 10).replaceAll("-", ".")}
            </span>
          </article>
        </section>

        <div className="content-grid">
          <section className="accounts-panel" id="accounts" aria-labelledby="accounts-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">GAME ACCOUNTS</p>
                <h2 id="accounts-title">수령 대상 계정</h2>
              </div>
              <span className="secure-badge">{connectedCount}/3 linked</span>
            </div>

            <div className="account-list">
              {snapshot
                ? snapshot.accounts.map((account, index) => (
                    <ConnectedAccountRow
                      account={account}
                      index={index}
                      key={account.maskedId}
                    />
                  ))
                : emptyAccountSlots.map((slot) => (
                    <div className="account-row" key={slot}>
                      <span className="account-number">0{slot}</span>
                      <div>
                        <strong>계정 {slot}</strong>
                        <small>
                          {authReadiness.configured
                            ? "Google 로그인 후 자동으로 확인됩니다."
                            : "OAuth 환경 변수 설정이 필요합니다."}
                        </small>
                      </div>
                      <span className="account-state">미연결</span>
                    </div>
                  ))}
            </div>

            <ClaimAllButton
              enabled={claimEnabled}
              csrfToken={session?.claimCsrfToken ?? null}
              disabledReason={claimDisabledReason}
              buttonLabel={
                auditEntries.length > 0
                  ? "실패·미수령 계정 다시 확인"
                  : "모든 계정에서 무료 토큰 수령"
              }
            />
          </section>

          <div id="diagnostics">
            <SystemDiagnostics />
          </div>
        </div>

        <ClaimAuditList entries={auditEntries} />

        <footer>
          <span>Domination Daily · OAuth credentials stay server-side</span>
          <span>Purchase flow is user-triggered only</span>
        </footer>
      </main>
    </div>
  );
}

function AuthControl({
  configured,
  session,
}: {
  configured: boolean;
  session: AppSession | null;
}) {
  if (session) {
    return (
      <div className="auth-control-group">
        <div className="profile-placeholder">
          <span>{session.admin.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{session.admin.name}</strong>
            <small>{session.admin.email}</small>
          </div>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="logout-button" type="submit">로그아웃</button>
        </form>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="profile-placeholder profile-disabled" aria-label="OAuth 설정 필요">
        <span>G</span>
        <div>
          <strong>Google 설정 필요</strong>
          <small>.env.local 확인</small>
        </div>
      </div>
    );
  }

  return (
    <a className="profile-placeholder profile-link" href="/api/auth/google/start">
      <span>G</span>
      <div>
        <strong>Google로 연결</strong>
        <small>관리자 계정만 허용</small>
      </div>
    </a>
  );
}

function ConnectedAccountRow({
  account,
  index,
}: {
  account: DashboardAccount;
  index: number;
}) {
  const stateLabels: Record<DashboardAccount["product"]["state"], string> = {
    available: "수령 가능",
    claimed: "오늘 수령됨",
    unavailable: "수령 불가",
    unverified: "검증 필요",
    missing: "상품 없음",
  };

  return (
    <div className="account-row">
      <span className="account-number">0{index + 1}</span>
      <div>
        <strong>{account.name}</strong>
        <small>
          {account.maskedId}
          {account.age !== null ? ` · Age ${account.age}` : ""}
          {account.trophies !== null ? ` · ${account.trophies} trophies` : ""}
        </small>
      </div>
      <span className={`account-state product-${account.product.state}`}>
        {stateLabels[account.product.state]}
      </span>
    </div>
  );
}

function AuthErrorBanner({ code }: { code: string }) {
  const messages: Record<string, string> = {
    OAUTH_FLOW_INVALID: "로그인 요청이 만료되었거나 일치하지 않습니다. 다시 로그인해 주세요.",
    OAUTH_PROVIDER_ERROR: "Google 로그인이 완료되지 않았습니다.",
    GOOGLE_TOKEN_REJECTED: "Google 인증을 확인하지 못했습니다. 다시 로그인해 주세요.",
    GOOGLE_REFRESH_TOKEN_MISSING: "장기 로그인 권한을 받지 못했습니다. Google 동의를 다시 진행해 주세요.",
    GOOGLE_REFRESH_REJECTED: "Google 장기 로그인이 만료되거나 취소되었습니다. 다시 로그인해 주세요.",
    DOMINATIONS_AUTH_REJECTED: "DomiNations World session 연결이 거부되었습니다.",
    XSOLLA_GOOGLE_TOKEN_REJECTED: "Xsolla가 Google 로그인 token을 거부했습니다.",
    DOMINATIONS_SIGNUP_REJECTED: "DomiNations World 로그인 시작 요청이 거부되었습니다.",
    DOMINATIONS_TOKEN_REJECTED: "DomiNations World session token 발급이 거부되었습니다.",
    ACCOUNT_COUNT_MISMATCH: "연결된 게임 계정이 정확히 3개인지 확인해 주세요.",
    SESSION_INVALID: "로그인 session이 올바르지 않아 삭제가 필요합니다.",
    SESSION_EXPIRED: "로그인 session이 만료되었습니다. 다시 로그인해 주세요.",
    SESSION_TOO_LARGE: "안전한 session 저장 한도를 초과했습니다.",
    UPSTREAM_UNAVAILABLE: "외부 서비스를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  };

  return (
    <div className="auth-error-banner" role="alert">
      <strong>연결 확인 필요</strong>
      <span>{messages[code] ?? "로그인 상태를 다시 확인해 주세요."}</span>
    </div>
  );
}

function readStringParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}
