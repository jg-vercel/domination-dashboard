import type { AppSession } from "@/lib/auth/session";

export function AuthControl({
  authConfigured,
  storeConfigured,
  session,
  unavailable = false,
}: {
  authConfigured: boolean;
  storeConfigured: boolean;
  session: AppSession | null;
  unavailable?: boolean;
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

  if (!authConfigured || !storeConfigured) {
    return (
      <div className="profile-placeholder profile-disabled" role="status">
        <span>G</span>
        <div>
          <strong>{!authConfigured ? "Google 로그인 준비 중" : "로그인 저장소 준비 중"}</strong>
          <small>서비스 설정이 필요합니다. 관리자에게 문의해 주세요.</small>
        </div>
      </div>
    );
  }

  if (unavailable) {
    return (
      <form action="/" method="get">
        <button className="profile-placeholder profile-link" type="submit">
          <span>G</span>
          <span className="profile-copy">
            <strong>로그인 상태 확인 지연</strong>
            <small>잠시 후 새로고침해 주세요.</small>
          </span>
        </button>
      </form>
    );
  }

  return (
    <a className="profile-placeholder profile-link" href="/api/auth/google/start">
      <span>G</span>
      <div>
        <strong>Google로 로그인</strong>
        <small>로그인 후 이 브라우저에서 상태가 유지됩니다.</small>
      </div>
    </a>
  );
}
