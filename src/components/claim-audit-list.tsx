import type { ClaimAuditEntry } from "@/lib/claims/audit";
import type { ClaimResultStatus } from "@/lib/claims/service";
import { REPLAYED_CLAIM_LABEL, claimReasonLabel, claimStatusLabel } from "@/lib/claims/presentation";

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
                      {claimStatusLabel(status)} {entry.summary[status]}
                    </span>
                  ) : null,
                )}
              </div>
              <div className="activity-accounts">
                {entry.results.map((result, resultIndex) => (
                  <div key={`${result.maskedAccountId}-${resultIndex}`}>
                    <span>{result.accountName} · {result.maskedAccountId} · {claimStatusLabel(result.status)}</span>
                    <br />
                    <span>{claimReasonLabel(result.reason)}</span>
                    {result.replayed && <><br /><span>{REPLAYED_CLAIM_LABEL}</span></>}
                  </div>
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
