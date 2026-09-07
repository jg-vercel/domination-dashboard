import "server-only";

import type { DomiNationsAccount } from "@/lib/dominations/client";
import type { ClaimStore } from "@/lib/idempotency/redis-rest";
import { listClaimAudits } from "./audit";

// This one deployment incident was verified from its Vercel function logs:
// first active account accepted, the next two startpurchase responses HTTP 429.
// No identifiers/credentials are embedded here; match only authenticated audit
// history and the exact incident window. Never reset arbitrary v2 unknowns.
export const VERIFIED_RATE_LIMIT_INCIDENT = {
  requestId: "4v64s-1788746697445-567227514471",
  cycleId: "2026-09-07",
  startsAt: Date.parse("2026-09-07T02:04:57.445Z"),
  endsAt: Date.parse("2026-09-07T02:05:57.445Z"),
} as const;

export async function findVerifiedRateLimitRepairs(
  subject: string,
  cycleId: string,
  accounts: DomiNationsAccount[],
  store: ClaimStore,
): Promise<Set<string>> {
  if (cycleId !== VERIFIED_RATE_LIMIT_INCIDENT.cycleId) return new Set();
  const entries = await listClaimAudits(subject, store, 50);
  const matching = entries.filter((entry) => {
    const time = Date.parse(entry.executedAt);
    const [first, second, third, fourth] = entry.results;
    return entry.cycleId === cycleId && time >= VERIFIED_RATE_LIMIT_INCIDENT.startsAt &&
      time <= VERIFIED_RATE_LIMIT_INCIDENT.endsAt && entry.results.length === 4 &&
      first?.status === "success" && first.reason === "CONFIRMED" && first.replayed === true &&
      second?.status === "success" && second.reason === "FREE_PURCHASE_ACCEPTED" && second.recovered === true && !second.replayed &&
      [third, fourth].every((result) => result?.status === "uncertain" && result.reason === "PURCHASE_RESPONSE_UNCONFIRMED" && result.recovered === true && !result.replayed);
  });
  if (matching.length !== 1) return new Set();
  const resolved = matching[0]!.results.map((result) => accounts.filter((account) =>
    account.name === result.accountName && `••••${account.gameAccountId.slice(-4)}` === result.maskedAccountId,
  ));
  if (resolved.some((candidates) => candidates.length !== 1)) return new Set();
  if (new Set(resolved.map((candidates) => candidates[0]!.gameAccountId)).size !== 4) return new Set();
  return new Set(resolved.slice(2).map((candidates) => candidates[0]!.gameAccountId));
}

export function isVerifiedIncidentRecord(value: string): boolean {
  try {
    const record: unknown = JSON.parse(value);
    if (typeof record !== "object" || record === null || Array.isArray(record)) return false;
    const payload = record as Record<string, unknown>;
    const time = typeof payload.recordedAt === "string" ? Date.parse(payload.recordedAt) : NaN;
    return payload.version === 2 && payload.status === "uncertain" && payload.reason === "PURCHASE_RESPONSE_UNCONFIRMED" &&
      payload.recovered === true && time >= VERIFIED_RATE_LIMIT_INCIDENT.startsAt && time <= VERIFIED_RATE_LIMIT_INCIDENT.endsAt;
  } catch {
    return false;
  }
}
