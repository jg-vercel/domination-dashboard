import "server-only";

import { AuthError } from "@/lib/auth/errors";

interface AttemptContext {
  accountIndex: number;
  accountAttempt: number;
  purchaseOrdinal: number;
  firstPurchaseInBatch: boolean;
  startedAt: number;
}

const purchaseFailures = [
  "SoldOut", "SoldOutWithRefresh", "InvalidItem", "UnknownItem",
  "ItemNotAvailable", "NoGiftsRemaining", "NotEnoughVirtualCurrency",
  "UnableToProcess", "OperationFailed", "Other",
] as const;

// Observational only: this class never waits, sends requests, or touches the
// ledger. Account position and actual purchase order are deliberately separate:
// replaying three successes can make account 4 the first purchase in a batch.
export class ClaimDiagnostics {
  private readonly startedAt: number;
  private purchaseOrdinal = 0;
  private previousAttemptAt: number | null = null;
  private previousResponseAt: number | null = null;

  constructor(private readonly clock: () => number = Date.now) {
    this.startedAt = clock();
  }

  beginAttempt(accountIndex: number, accountAttempt: number): AttemptContext {
    const now = this.clock();
    const context = {
      accountIndex,
      accountAttempt,
      purchaseOrdinal: ++this.purchaseOrdinal,
      firstPurchaseInBatch: this.purchaseOrdinal === 1,
      startedAt: now,
    };
    logClaimDiagnostic("Free token attempt started", {
      ...publicContext(context),
      batchElapsedMs: elapsed(now, this.startedAt),
      sincePreviousAttemptMs: elapsed(now, this.previousAttemptAt),
      sincePreviousResponseMs: elapsed(now, this.previousResponseAt),
    });
    this.previousAttemptAt = now;
    return context;
  }

  freeAcknowledged(context: AttemptContext): void {
    this.complete(context, { outcome: "free_acknowledged" });
  }

  rejected(context: AttemptContext, error: unknown): void {
    const diagnostic = error instanceof AuthError ? error.diagnostic : undefined;
    const outcome = error instanceof AuthError
      ? error.code === "PURCHASE_RATE_LIMITED" ? "rate_limited"
        : error.code === "PURCHASE_REJECTED" ? "rejected"
          : error.code === "PAID_CHECKOUT_REJECTED" ? "paid_checkout"
            : "unconfirmed"
      : "unconfirmed";
    const status = diagnostic?.status;
    this.complete(context, {
      outcome,
      httpStatus: typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
      purchaseFailure: purchaseFailures.find((value) => value === diagnostic?.purchaseFailure) ?? null,
      retryAfterMs: nonnegative(diagnostic?.retryAfterMs),
    });
  }

  private complete(context: AttemptContext, outcome: Record<string, unknown>): void {
    const now = this.clock();
    this.previousResponseAt = now;
    logClaimDiagnostic("Free token attempt completed", {
      ...publicContext(context),
      batchElapsedMs: elapsed(now, this.startedAt),
      requestDurationMs: elapsed(now, context.startedAt),
      ...outcome,
    });
  }
}

function publicContext(context: AttemptContext) {
  return {
    accountIndex: context.accountIndex,
    accountAttempt: context.accountAttempt,
    purchaseOrdinal: context.purchaseOrdinal,
    firstPurchaseInBatch: context.firstPurchaseInBatch,
  };
}

function elapsed(now: number, since: number | null): number | null {
  return since === null ? null : nonnegative(Math.max(0, now - since));
}

function nonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// A logging outage must not turn an acknowledged purchase into an unknown
// result or change which accounts are processed. Callers pass fixed schemas.
export function logClaimDiagnostic(event: string, fields: Record<string, unknown>): void {
  try {
    console.info(event, fields);
  } catch {
    // Best-effort, non-mutating diagnostics.
  }
}
