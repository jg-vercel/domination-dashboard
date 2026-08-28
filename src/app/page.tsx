import { SystemDiagnostics } from "@/components/system-diagnostics";

const accountSlots = [1, 2, 3];

export default function Home() {
  return (
    <div className="app-shell">
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
            <p className="eyebrow">FRIDAY · 28 AUGUST</p>
            <h1>오늘의 무료 보상을 준비하세요.</h1>
          </div>
          <div className="profile-placeholder" aria-label="Google 로그인 미연결">
            <span>G</span>
            <div>
              <strong>Google 연결 대기</strong>
              <small>Issue #3에서 활성화</small>
            </div>
          </div>
        </header>

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
              <strong>0 <small>/ 3</small></strong>
            </div>
            <span className="card-status pending">연결 전</span>
          </article>
          <article className="stat-card">
            <span className="stat-icon blue">✓</span>
            <div>
              <p>오늘 수령</p>
              <strong>0 <small>/ 3</small></strong>
            </div>
            <span className="card-status neutral">대기</span>
          </article>
          <article className="stat-card">
            <span className="stat-icon violet">◷</span>
            <div>
              <p>다음 갱신</p>
              <strong>09:00</strong>
            </div>
            <span className="card-status neutral">KST</span>
          </article>
        </section>

        <div className="content-grid">
          <section className="accounts-panel" id="accounts" aria-labelledby="accounts-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">GAME ACCOUNTS</p>
                <h2 id="accounts-title">수령 대상 계정</h2>
              </div>
              <span className="secure-badge">3 slots</span>
            </div>

            <div className="account-list">
              {accountSlots.map((slot) => (
                <div className="account-row" key={slot}>
                  <span className="account-number">0{slot}</span>
                  <div>
                    <strong>계정 {slot}</strong>
                    <small>Google 로그인 후 자동으로 확인됩니다.</small>
                  </div>
                  <span className="account-state">미연결</span>
                </div>
              ))}
            </div>

            <button className="disabled-button" type="button" disabled>
              모든 계정에서 무료 토큰 수령
            </button>
            <p className="button-hint">로그인·수령 기능 구현 후 활성화됩니다.</p>
          </section>

          <div id="diagnostics">
            <SystemDiagnostics />
          </div>
        </div>

        <footer>
          <span>Domination Daily · MVP foundation</span>
          <span>Purchase flow is user-triggered only</span>
        </footer>
      </main>
    </div>
  );
}
