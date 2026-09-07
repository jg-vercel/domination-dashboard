import "server-only";

import { createHash } from "node:crypto";

import { createRandomToken } from "@/lib/auth/crypto";
import { AuthError } from "@/lib/auth/errors";
import type { AppSession, DomiNationsCredential } from "@/lib/auth/session";
import {
  findTargetProduct,
  getProductState,
  loadAccountDirectory,
} from "@/lib/dashboard/snapshot";
import {
  getProductsForAccount,
  startFreePurchase,
  type DomiNationsAccount,
  type StoreProduct,
} from "@/lib/dominations/client";
import type { ClaimStore } from "@/lib/idempotency/redis-rest";

import { getClaimCycle, type ClaimCycle } from "./cycle";
import { recordClaimAudit } from "./audit";
import { BATCH_LOCK_TTL_SECONDS, ClaimPacer, ClaimPacingDeferredError, MAX_PURCHASE_ATTEMPTS } from "./pacing";
import { findVerifiedRateLimitRepairs, isVerifiedIncidentRecord, VERIFIED_RATE_LIMIT_INCIDENT } from "./verified-rate-limit-repair";

export type ClaimResultStatus =
  | "success"
  | "already_claimed"
  | "duplicate"
  | "ineligible"
  | "failed"
  | "uncertain";

export interface AccountClaimResult {
  accountName: string;
  maskedAccountId: string;
  status: ClaimResultStatus;
  replayed?: true;
  recovered?: true;
  reason:
    | "CONFIRMED"
    | "ALREADY_CLAIMED"
    | "PREVIOUS_RESULT"
    | "ACCOUNT_IN_PROGRESS"
    | "ITEM_MISSING"
    | "ITEM_NOT_VERIFIED"
    | "ITEM_NOT_AVAILABLE"
    | "PAID_TOKEN_REJECTED"
    | "STORE_PURCHASE_REJECTED"
    | "STORE_PURCHASE_LIMIT"
    | "STORE_ITEM_UNAVAILABLE"
    | "PREVIOUS_OUTCOME_UNKNOWN"
    | "FREE_PURCHASE_ACCEPTED"
    | "PURCHASE_RESPONSE_UNCONFIRMED"
    | "LEGACY_RECOVERY_UNAVAILABLE"
    | "STORE_RATE_LIMITED"
    | "BATCH_TIME_BUDGET"
    | "UPSTREAM_BEFORE_PURCHASE"
    | "POST_PURCHASE_UNCONFIRMED";
}

export interface BatchClaimResult {
  cycle: ClaimCycle;
  results: AccountClaimResult[];
  summary: Record<ClaimResultStatus, number>;
  auditRecorded: boolean;
}

export class BatchClaimInProgressError extends Error {
  constructor() {
    super("BATCH_CLAIM_IN_PROGRESS");
    this.name = "BatchClaimInProgressError";
  }
}

export interface ClaimServiceDependencies {
  store: ClaimStore;
  fetchImplementation?: typeof fetch;
  now?: Date;
  createOwnerToken?: () => string;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

type ConnectedAppSession = AppSession & {
  dominations: DomiNationsCredential;
};

export async function claimFreeLegendaryTokenForAllAccounts(
  session: AppSession,
  dependencies: ClaimServiceDependencies,
): Promise<BatchClaimResult> {
  requireDomiNationsSession(session);
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const cycle = getClaimCycle(dependencies.now);
  const createOwnerToken = dependencies.createOwnerToken ?? createRandomToken;
  const batchKey = `domi:claim:batch:${cycle.id}:${digest(session.admin.subject)}`;
  const batchOwner = createOwnerToken();
  const batchLockAcquired = await dependencies.store.setNx(
    batchKey,
    batchOwner,
    BATCH_LOCK_TTL_SECONDS,
  );

  if (!batchLockAcquired) {
    throw new BatchClaimInProgressError();
  }

  try {
    const pacer = new ClaimPacer(
      dependencies.store,
      `domi:claim:pace:${digest(session.admin.subject)}`,
      dependencies.clock,
      dependencies.sleep,
    );
    const accounts = await loadAccountDirectory(
      session.dominations,
      fetchImplementation,
    );
    const results: AccountClaimResult[] = [];
    const verifiedRepairs = await findVerifiedRateLimitRepairs(
      session.admin.subject, cycle.id, accounts, dependencies.store,
    ).catch(() => new Set<string>());

    for (const account of accounts) {
      const result = await claimAccount(
        session,
        account,
        cycle,
        dependencies.store,
        fetchImplementation,
        createOwnerToken,
        pacer,
        verifiedRepairs.has(account.gameAccountId),
      );
      results.push(result);
      // Only fixed, public outcome codes: never identifiers, credentials or
      // upstream response bodies. This also survives a later batch timeout.
      console.info("Free token claim result", {
        accountIndex: results.length,
        status: result.status,
        reason: result.reason,
        replayed: result.replayed === true,
        recovered: result.recovered === true,
      });
    }

    const summary = summarize(results);
    const auditRecorded = await recordClaimAudit(
      session.admin.subject,
      cycle,
      results,
      summary,
      dependencies.store,
      dependencies.now,
    ).then(
      () => true,
      () => false,
    );
    return { cycle, results, summary, auditRecorded };
  } finally {
    await dependencies.store.compareDelete(batchKey, batchOwner).catch(() => false);
  }
}

async function claimAccount(
  session: ConnectedAppSession,
  account: DomiNationsAccount,
  cycle: ClaimCycle,
  store: ClaimStore,
  fetchImplementation: typeof fetch,
  createOwnerToken: () => string,
  pacer: ClaimPacer,
  verifiedRateLimitRepair: boolean,
): Promise<AccountClaimResult> {
  const accountHash = digest(
    `${session.admin.subject}:${account.gameAccountId}:Free Legendary Token`,
  );
  const ledgerKey = `domi:claim:ledger:${cycle.id}:${accountHash}`;
  const accountLockKey = `domi:claim:account:${cycle.id}:${accountHash}`;
  const recoveryKey = `domi:claim:recovery:${cycle.id}:${accountHash}`;
  const publicAccount = {
    accountName: account.name,
    maskedAccountId: maskAccountId(account.gameAccountId),
  };
  const previousResult = await store.get(ledgerKey);

  const canRepair = (value: string) => verifiedRateLimitRepair && isVerifiedIncidentRecord(value);
  if (previousResult !== null && ledgerAction(previousResult) === "skip" && !canRepair(previousResult)) {
    return { ...publicAccount, ...readPreviousOutcome(previousResult) };
  }

  const accountOwner = createOwnerToken();
  const accountLockAcquired = await store.setNx(
    accountLockKey,
    accountOwner,
    cycle.ledgerTtlSeconds,
  );
  if (!accountLockAcquired) {
    return {
      ...publicAccount,
      status: "duplicate",
      reason: "ACCOUNT_IN_PROGRESS",
    };
  }

  let purchaseSent = false;
  let durableOutcomeRecorded = false;
  let definitelyNotPurchased = false;
  let recoveryStarted = false;
  let purchaseAcknowledged = false;
  try {
    // A prior owner may have finished before we acquired this account lock.
    let completedWhileWaiting = await store.get(ledgerKey);
    if (completedWhileWaiting !== null && canRepair(completedWhileWaiting)) {
      const archived = await store.setNx(
        `domi:claim:rate-repair:${cycle.id}:${accountHash}`,
        JSON.stringify({ requestId: VERIFIED_RATE_LIMIT_INCIDENT.requestId, httpStatus: 429, previousRecord: completedWhileWaiting }),
        cycle.ledgerTtlSeconds,
      );
      if (!archived) return { ...publicAccount, ...readPreviousOutcome(completedWhileWaiting) };
      const repaired: AccountClaimResult = { ...publicAccount, status: "failed", reason: "STORE_RATE_LIMITED", recovered: true };
      await writeLedger(store, ledgerKey, repaired, cycle.ledgerTtlSeconds);
      completedWhileWaiting = await store.get(ledgerKey);
      recoveryStarted = true;
      console.info("Free token verified 429 repair", { reason: "STORE_RATE_LIMITED" });
    }
    if (completedWhileWaiting !== null && ledgerAction(completedWhileWaiting) === "skip") {
      return { ...publicAccount, ...readPreviousOutcome(completedWhileWaiting) };
    }
    const recoverLegacy = completedWhileWaiting !== null && ledgerAction(completedWhileWaiting) === "recover";
    if (recoverLegacy && await store.get(recoveryKey) !== null) {
      return { ...publicAccount, status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED", replayed: true };
    }

    await pacer.waitForTurn();

    let products: StoreProduct[];
    try {
      products = await getProductsForAccount(
        session.dominations,
        account.gameAccountId,
        fetchImplementation,
      );
    } catch {
      if (recoverLegacy) {
        return { ...publicAccount, status: "uncertain", reason: "LEGACY_RECOVERY_UNAVAILABLE", replayed: true };
      }
      return { ...publicAccount, status: "failed", reason: "UPSTREAM_BEFORE_PURCHASE" };
    }
    let target = findTargetProduct(products);
    const targetState = getProductState(target);

    // Current availability is a condition for the user-authorized, one-time
    // recovery attempt, not proof that the original purchase failed.
    if (recoverLegacy && targetState.state !== "available") {
      return { ...publicAccount, status: "uncertain", reason: "LEGACY_RECOVERY_UNAVAILABLE", replayed: true };
    }
    if (!target) {
      return { ...publicAccount, status: "ineligible", reason: "ITEM_MISSING" };
    }
    if (targetState.state === "claimed") {
      const result: AccountClaimResult = { ...publicAccount, status: "already_claimed", reason: "ALREADY_CLAIMED" };
      await writeLedger(store, ledgerKey, result, cycle.ledgerTtlSeconds);
      return result;
    }
    if (targetState.state === "unverified") {
      return { ...publicAccount, status: "ineligible", reason: "ITEM_NOT_VERIFIED" };
    }
    if (targetState.state !== "available") {
      return { ...publicAccount, status: "ineligible", reason: "ITEM_NOT_AVAILABLE" };
    }
    for (let attempt = 0; attempt < MAX_PURCHASE_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await pacer.waitForTurn();
        // Availability can change while backing off. Never retry using a
        // stale paid, locked, exhausted, or otherwise unverified listing.
        const refreshed = await getProductsForAccount(session.dominations, account.gameAccountId, fetchImplementation);
        target = findTargetProduct(refreshed);
        if (!target || getProductState(target).state !== "available") {
          const result: AccountClaimResult = {
            ...publicAccount, status: "failed", reason: "STORE_ITEM_UNAVAILABLE",
            ...(recoveryStarted ? { recovered: true as const } : {}),
          };
          await writeLedger(store, ledgerKey, result, cycle.ledgerTtlSeconds);
          durableOutcomeRecorded = true;
          return result;
        }
      }
      await pacer.recordAttempt();
      if (recoverLegacy && attempt === 0) {
        // Reserve recovery only once pacing/budget checks have succeeded.
        // Preserve the original evidence before any external purchase.
        recoveryStarted = await store.setNx(
          recoveryKey,
          JSON.stringify({ version: 2, state: "in_flight", previousRecord: completedWhileWaiting }),
          cycle.ledgerTtlSeconds,
        );
        if (!recoveryStarted) {
          return { ...publicAccount, status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED", replayed: true };
        }
      }
      purchaseSent = true;
      definitelyNotPurchased = false;
      try {
        await startFreePurchase(session.dominations, account.gameAccountId, target, fetchImplementation);
        break;
      } catch (error) {
        if (!(error instanceof AuthError) || error.code !== "PURCHASE_RATE_LIMITED") throw error;
        const delayMs = Math.max(error.diagnostic?.retryAfterMs ?? 0, 10_000 * 2 ** attempt);
        console.info("Free token rate limit wait", { attempt: attempt + 1, delayMs });
        await pacer.defer(delayMs);
        definitelyNotPurchased = true;
        if (attempt + 1 === MAX_PURCHASE_ATTEMPTS) throw error;
      }
    }
    purchaseAcknowledged = true;

    // The official free flow completes on orderAccessToken === "free".
    // Catalog refresh is not an order receipt and may lag behind acceptance.
    const result: AccountClaimResult = {
      ...publicAccount,
      status: "success",
      reason: "FREE_PURCHASE_ACCEPTED",
      ...(recoveryStarted ? { recovered: true as const } : {}),
    };
    await writeLedger(store, ledgerKey, result, cycle.ledgerTtlSeconds);
    durableOutcomeRecorded = true;
    return result;
  } catch (error) {
    if (error instanceof ClaimPacingDeferredError) {
      const result: AccountClaimResult = { ...publicAccount, status: "failed", reason: error.reason };
      if (purchaseSent && definitelyNotPurchased) {
        await writeLedger(store, ledgerKey, result, cycle.ledgerTtlSeconds);
        durableOutcomeRecorded = true;
      }
      return result;
    }
    // Storage failures are not store rejections. Preserve existing evidence,
    // and retain the lock if a free acknowledgment could not be persisted.
    if (!purchaseSent || purchaseAcknowledged) throw error;
    if (error instanceof AuthError) {
      console.warn("Free token purchase response", {
        code: error.code,
        status: error.diagnostic?.status,
        reason: error.diagnostic?.reason,
        purchaseFailure: error.diagnostic?.purchaseFailure,
        retryAfterMs: error.diagnostic?.retryAfterMs,
      });
    }
    if (error instanceof AuthError && error.code === "PURCHASE_RATE_LIMITED") {
      const result: AccountClaimResult = {
        ...publicAccount, status: "failed", reason: "STORE_RATE_LIMITED",
        ...(recoveryStarted ? { recovered: true as const } : {}),
      };
      await writeLedger(store, ledgerKey, result, cycle.ledgerTtlSeconds);
      durableOutcomeRecorded = true;
      return result;
    }
    if (definitelyNotPurchased) {
      // The last purchase received 429; failure while refreshing the catalog
      // for a later attempt must not erase that evidence of non-completion.
      const result: AccountClaimResult = { ...publicAccount, status: "failed", reason: "UPSTREAM_BEFORE_PURCHASE" };
      await writeLedger(store, ledgerKey, result, cycle.ledgerTtlSeconds);
      durableOutcomeRecorded = true;
      return result;
    }
    if (error instanceof AuthError && error.code === "PURCHASE_REJECTED") {
      const failure = error.diagnostic?.purchaseFailure;
      const limitReached = failure === "SoldOut" || failure === "SoldOutWithRefresh";
      // A terminal limit still needs a durable record (or the retained lock)
      // before another request can safely inspect this account again.
      definitelyNotPurchased = !limitReached;
      const itemUnavailable = failure === "InvalidItem" || failure === "UnknownItem" || failure === "ItemNotAvailable";
      const result: AccountClaimResult = {
        ...publicAccount,
        ...(recoveryStarted ? { recovered: true as const } : {}),
        status: limitReached ? "ineligible" : "failed",
        reason: limitReached
          ? "STORE_PURCHASE_LIMIT"
          : itemUnavailable
            ? "STORE_ITEM_UNAVAILABLE"
            : "STORE_PURCHASE_REJECTED",
      };
      // Only versioned, explicit non-limit rejections may be retried by a
      // later button click. Unknown outcomes must never enter that path.
      await writeLedger(store, ledgerKey, result, cycle.ledgerTtlSeconds);
      durableOutcomeRecorded = true;
      return result;
    }
    const paidTokenRejected =
      error instanceof AuthError && error.code === "PAID_CHECKOUT_REJECTED";
    const result: AccountClaimResult = paidTokenRejected
      ? {
          ...publicAccount,
          status: "ineligible",
          reason: "PAID_TOKEN_REJECTED",
        }
      : {
          ...publicAccount,
          status: "uncertain",
          reason: "PURCHASE_RESPONSE_UNCONFIRMED",
        };
    if (recoveryStarted) result.recovered = true;

    await writeLedger(store, ledgerKey, result, cycle.ledgerTtlSeconds);
    durableOutcomeRecorded = true;
    return result;
  } finally {
    if (!purchaseSent || definitelyNotPurchased || durableOutcomeRecorded) {
      await store.compareDelete(accountLockKey, accountOwner).catch(() => false);
    }
  }
}

function ledgerAction(value: string): "skip" | "recover" | "retry_rejection" {
  try {
    const payload: unknown = JSON.parse(value);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return "skip";
    const record = payload as Record<string, unknown>;
    if (!Object.hasOwn(record, "version") && record.status === "uncertain" && record.reason === "POST_PURCHASE_UNCONFIRMED") {
      return "recover";
    }
    if (record.version === 2 && record.status === "failed" &&
      (record.reason === "STORE_PURCHASE_REJECTED" || record.reason === "STORE_ITEM_UNAVAILABLE" || record.reason === "STORE_RATE_LIMITED" || record.reason === "BATCH_TIME_BUDGET" || record.reason === "UPSTREAM_BEFORE_PURCHASE")) {
      return "retry_rejection";
    }
  } catch {
    // Unrecognized/corrupt records are not authorized recovery candidates.
  }
  return "skip";
}

function readPreviousOutcome(value: string): Pick<AccountClaimResult, "status" | "reason" | "replayed" | "recovered"> {
  try {
    const payload: unknown = JSON.parse(value);
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      const { status, reason, version, recovered } = payload as Record<string, unknown>;
      // Old paid-token records also include malformed/denied responses from
      // the old adapter. They cannot be safely reclassified as retryable.
      const recognized =
        (status === "success" && reason === "CONFIRMED") ||
        (version === 2 && status === "success" && reason === "FREE_PURCHASE_ACCEPTED") ||
        (status === "already_claimed" && reason === "ALREADY_CLAIMED") ||
        (status === "uncertain" && reason === "POST_PURCHASE_UNCONFIRMED") ||
        (version === 2 && status === "uncertain" && reason === "PURCHASE_RESPONSE_UNCONFIRMED") ||
        (status === "ineligible" && (reason === "PAID_TOKEN_REJECTED" || reason === "STORE_PURCHASE_LIMIT"));
      if (recognized) {
        return {
          status: status as ClaimResultStatus,
          reason: reason as AccountClaimResult["reason"],
          replayed: true,
          ...(version === 2 && recovered === true ? { recovered: true as const } : {}),
        };
      }
    }
  } catch {
    // An unreadable record is not proof that no purchase happened.
  }
  return { status: "uncertain", reason: "PREVIOUS_OUTCOME_UNKNOWN", replayed: true };
}

function requireDomiNationsSession(
  session: AppSession,
): asserts session is ConnectedAppSession {
  if (!session.dominations) {
    throw new AuthError("DOMINATIONS_SESSION_REQUIRED");
  }
}

async function writeLedger(
  store: ClaimStore,
  key: string,
  result: AccountClaimResult,
  ttlSeconds: number,
) {
  await store.set(
    key,
    JSON.stringify({
      version: 2,
      status: result.status,
      reason: result.reason,
      ...(result.recovered ? { recovered: true } : {}),
      recordedAt: new Date().toISOString(),
    }),
    ttlSeconds,
  );
}

function summarize(
  results: AccountClaimResult[],
): Record<ClaimResultStatus, number> {
  const summary: Record<ClaimResultStatus, number> = {
    success: 0,
    already_claimed: 0,
    duplicate: 0,
    ineligible: 0,
    failed: 0,
    uncertain: 0,
  };
  for (const result of results) summary[result.status] += 1;
  return summary;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24);
}

function maskAccountId(value: string): string {
  return `••••${value.slice(-4)}`;
}
