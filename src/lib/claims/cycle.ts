export const KST_OFFSET_HOURS = 9;
export const KST_RESET_HOUR = 9;
export const CLAIM_CYCLE_SECONDS = 24 * 60 * 60;
export const LEDGER_RETENTION_SECONDS = 24 * 60 * 60;

export interface ClaimCycle {
  id: string;
  startsAt: string;
  endsAt: string;
  ledgerTtlSeconds: number;
}

export function getClaimCycle(now = new Date()): ClaimCycle {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("invalid date");
  }

  const kst = new Date(nowMs + KST_OFFSET_HOURS * 60 * 60 * 1_000);
  if (kst.getUTCHours() < KST_RESET_HOUR) {
    kst.setUTCDate(kst.getUTCDate() - 1);
  }

  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  const day = kst.getUTCDate();
  // KST 09:00 is UTC 00:00 on the same calendar date.
  const startsAtMs = Date.UTC(year, month, day, 0, 0, 0, 0);
  const endsAtMs = startsAtMs + CLAIM_CYCLE_SECONDS * 1_000;
  const id = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const ttlUntilRetentionEnd = Math.ceil(
    (endsAtMs + LEDGER_RETENTION_SECONDS * 1_000 - nowMs) / 1_000,
  );

  return {
    id,
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
    ledgerTtlSeconds: Math.max(ttlUntilRetentionEnd, 60),
  };
}
