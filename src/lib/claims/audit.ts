import "server-only";

import { createHash } from "node:crypto";

import type { ClaimStore } from "@/lib/idempotency/redis-rest";

import type {
  AccountClaimResult,
  ClaimResultStatus,
} from "./service";
import type { ClaimCycle } from "./cycle";

export const CLAIM_AUDIT_MAX_ITEMS = 50;
export const CLAIM_AUDIT_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface ClaimAuditEntry {
  version: 1;
  cycleId: string;
  executedAt: string;
  summary: Record<ClaimResultStatus, number>;
  results: AccountClaimResult[];
}

const validStatuses: ClaimResultStatus[] = [
  "success",
  "already_claimed",
  "duplicate",
  "ineligible",
  "failed",
  "uncertain",
];

const validReasons: AccountClaimResult["reason"][] = [
  "CONFIRMED",
  "ALREADY_CLAIMED",
  "PREVIOUS_RESULT",
  "ACCOUNT_IN_PROGRESS",
  "ITEM_MISSING",
  "ITEM_NOT_VERIFIED",
  "ITEM_NOT_AVAILABLE",
  "PAID_TOKEN_REJECTED",
  "UPSTREAM_BEFORE_PURCHASE",
  "POST_PURCHASE_UNCONFIRMED",
];

export async function recordClaimAudit(
  adminSubject: string,
  cycle: ClaimCycle,
  results: AccountClaimResult[],
  summary: Record<ClaimResultStatus, number>,
  store: ClaimStore,
  now = new Date(),
): Promise<void> {
  const entry: ClaimAuditEntry = {
    version: 1,
    cycleId: cycle.id,
    executedAt: now.toISOString(),
    summary,
    results,
  };
  await store.appendList(
    auditKey(adminSubject),
    JSON.stringify(entry),
    CLAIM_AUDIT_MAX_ITEMS,
    CLAIM_AUDIT_TTL_SECONDS,
  );
}

export async function listClaimAudits(
  adminSubject: string,
  store: ClaimStore,
  limit = 10,
): Promise<ClaimAuditEntry[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), CLAIM_AUDIT_MAX_ITEMS);
  const values = await store.listRange(auditKey(adminSubject), 0, safeLimit - 1);
  return values.flatMap((value) => {
    const entry = parseAuditEntry(value);
    return entry ? [entry] : [];
  });
}

export function parseAuditEntry(value: string): ClaimAuditEntry | null {
  try {
    const payload: unknown = JSON.parse(value);
    if (!isRecord(payload) || payload.version !== 1) return null;
    if (
      typeof payload.cycleId !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(payload.cycleId) ||
      typeof payload.executedAt !== "string" ||
      !Number.isFinite(Date.parse(payload.executedAt)) ||
      !isSummary(payload.summary) ||
      !Array.isArray(payload.results)
    ) {
      return null;
    }

    const results = payload.results.map(parseAuditResult);
    if (results.some((result) => result === null)) return null;

    return {
      version: 1,
      cycleId: payload.cycleId,
      executedAt: payload.executedAt,
      summary: payload.summary,
      results: results as AccountClaimResult[],
    };
  } catch {
    return null;
  }
}

function parseAuditResult(value: unknown): AccountClaimResult | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.accountName !== "string" ||
    typeof value.maskedAccountId !== "string" ||
    !value.maskedAccountId.startsWith("••••") ||
    !validStatuses.includes(value.status as ClaimResultStatus) ||
    !validReasons.includes(value.reason as AccountClaimResult["reason"])
  ) {
    return null;
  }
  return {
    accountName: value.accountName,
    maskedAccountId: value.maskedAccountId,
    status: value.status as ClaimResultStatus,
    reason: value.reason as AccountClaimResult["reason"],
  };
}

function isSummary(value: unknown): value is Record<ClaimResultStatus, number> {
  if (!isRecord(value)) return false;
  return validStatuses.every(
    (status) =>
      typeof value[status] === "number" &&
      Number.isInteger(value[status]) &&
      Number(value[status]) >= 0,
  );
}

function auditKey(adminSubject: string): string {
  const digest = createHash("sha256")
    .update(adminSubject, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `domi:claim:audit:${digest}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
