import type { ClaimAuditEntry } from "@/lib/claims/audit";
import type { ClaimResultStatus } from "@/lib/claims/service";

export function ClaimAuditList({ entries }: { entries: ClaimAuditEntry[] }) {
  return (
    <section className="activity-panel" aria-labelledby="activity-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">RECENT ACTIVITY</p>
          <h2 id="activity-title">최근 수령 기록</h2>
        </div>
        <span className="secure-badge">민감정보 제거 · 30일</span>
      </div>

      {entries.length === 0 ? (
        <div className="activity-empty">
          <span aria-hidden="true">↻</span>
          <div>
            <strong>아직 수령 기록이 없습니다.</strong>
            <p>첫 실행 후 cycle과 계정별 결과가 이곳에 보존됩니다.</p>
          </div>
        </div>
      ) : (
        <div className="activity-list">
          {entries.map((entry, index) => (
            <article className="activity-entry" key={`${entry.executedAt}-${index}`}>
              <div className="activity-meta">
                <strong>Cycle {entry.cycleId}</strong>
                <time dateTime={entry.executedAt}>{formatKst(entry.executedAt)}</time>
              </div>
              <div className="activity-summary" aria-label="실행 요약">
                {statusOrder.map((status) =>
                  entry.summary[status] > 0 ? (
                    <span className={`audit-${status}`} key={status}>
                      {statusLabel(status)} {entry.summary[status]}
                    </span>
                  ) : null,
                )}
              </div>
              <div className="activity-accounts">
                {entry.results.map((result) => (
                  <span key={`${result.maskedAccountId}-${result.status}`}>
                    {result.accountName} · {result.maskedAccountId} · {statusLabel(result.status)}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

const statusOrder: ClaimResultStatus[] = [
  "success",
  "already_claimed",
  "duplicate",
  "ineligible",
  "failed",
  "uncertain",
];

function statusLabel(status: ClaimResultStatus): string {
  return {
    success: "성공",
    already_claimed: "이미 수령",
    duplicate: "중복 차단",
    ineligible: "자격 없음",
    failed: "실패",
    uncertain: "확인 필요",
  }[status];
}

function formatKst(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
