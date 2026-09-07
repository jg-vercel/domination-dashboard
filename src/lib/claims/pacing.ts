import "server-only";

import { RedisStoreError, type ClaimStore } from "@/lib/idempotency/redis-rest";

// An operational starting interval, not a published DomiNations rate limit.
export const PURCHASE_INTERVAL_MS = 5_000;
export const MAX_PURCHASE_ATTEMPTS = 4;
export const CLAIM_EXECUTION_BUDGET_MS = 240_000;
export const BATCH_LOCK_TTL_SECONDS = 330;
const REQUEST_RESERVE_MS = 25_000;

export class ClaimPacingDeferredError extends Error {
  constructor(public readonly reason: "STORE_RATE_LIMITED" | "BATCH_TIME_BUDGET") {
    super(reason);
    this.name = "ClaimPacingDeferredError";
  }
}

export class ClaimPacer {
  private localNextAttempt = 0;
  private readonly deadline: number;

  constructor(
    private readonly store: ClaimStore,
    private readonly key: string,
    private readonly clock: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> =
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.deadline = clock() + CLAIM_EXECUTION_BUDGET_MS;
  }

  async waitForTurn(): Promise<void> {
    this.checkBudget();
    const raw = await this.store.get(this.key);
    const stored = raw === null ? 0 : Number(raw);
    if (
      !Number.isSafeInteger(stored) ||
      stored < 0 ||
      (raw !== null && !/^(0|[1-9]\d*)$/.test(raw))
    ) {
      throw new RedisStoreError();
    }
    const nextAttempt = Math.max(stored, this.localNextAttempt);
    if (nextAttempt + REQUEST_RESERVE_MS > this.deadline) {
      throw new ClaimPacingDeferredError("STORE_RATE_LIMITED");
    }
    while (nextAttempt > this.clock()) {
      // Bound each wait; never shorten the server's Retry-After interval.
      await this.sleep(Math.min(nextAttempt - this.clock(), 50_000));
    }
    this.checkBudget();
  }

  async recordAttempt(): Promise<void> {
    this.checkBudget();
    await this.defer(PURCHASE_INTERVAL_MS);
    // Include time spent persisting the gate in the in-batch interval.
    this.localNextAttempt = Math.max(this.localNextAttempt, this.clock() + PURCHASE_INTERVAL_MS);
  }

  async defer(delayMs: number): Promise<void> {
    const nextAttempt = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.clock() + Math.max(PURCHASE_INTERVAL_MS, delayMs),
    );
    this.localNextAttempt = Math.max(this.localNextAttempt, nextAttempt);
    const ttlSeconds = Math.min(2_147_483_647, Math.ceil((this.localNextAttempt - this.clock()) / 1_000) + BATCH_LOCK_TTL_SECONDS);
    await this.store.set(this.key, String(this.localNextAttempt), ttlSeconds);
  }

  private checkBudget() {
    if (this.clock() + REQUEST_RESERVE_MS > this.deadline) {
      throw new ClaimPacingDeferredError("BATCH_TIME_BUDGET");
    }
  }
}
