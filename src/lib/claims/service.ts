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
  reason:
    | "CONFIRMED"
    | "ALREADY_CLAIMED"
    | "PREVIOUS_RESULT"
    | "ACCOUNT_IN_PROGRESS"
    | "ITEM_MISSING"
    | "ITEM_NOT_VERIFIED"
    | "ITEM_NOT_AVAILABLE"
    | "PAID_TOKEN_REJECTED"
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
    180,
  );

  if (!batchLockAcquired) {
    throw new BatchClaimInProgressError();
  }

  try {
    const accounts = await loadAccountDirectory(
      session.dominations,
      fetchImplementation,
    );
    const results: AccountClaimResult[] = [];

    for (const account of accounts) {
      results.push(
        await claimAccount(
          session,
          account,
          cycle,
          dependencies.store,
          fetchImplementation,
          createOwnerToken,
        ),
      );
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
): Promise<AccountClaimResult> {
  const accountHash = digest(
    `${session.admin.subject}:${account.gameAccountId}:Free Legendary Token`,
  );
  const ledgerKey = `domi:claim:ledger:${cycle.id}:${accountHash}`;
  const accountLockKey = `domi:claim:account:${cycle.id}:${accountHash}`;
  const publicAccount = {
    accountName: account.name,
    maskedAccountId: maskAccountId(account.gameAccountId),
  };
  const previousResult = await store.get(ledgerKey);

  if (previousResult !== null) {
    return {
      ...publicAccount,
      status: "duplicate",
      reason: "PREVIOUS_RESULT",
    };
  }

  let products: StoreProduct[];
  try {
    products = await getProductsForAccount(
      session.dominations,
      account.gameAccountId,
      fetchImplementation,
    );
  } catch (error) {
    if (error instanceof AuthError && error.code === "SESSION_EXPIRED") throw error;
    return {
      ...publicAccount,
      status: "failed",
      reason: "UPSTREAM_BEFORE_PURCHASE",
    };
  }

  const target = findTargetProduct(products);
  const targetState = getProductState(target);

  if (!target) {
    return { ...publicAccount, status: "ineligible", reason: "ITEM_MISSING" };
  }
  if (targetState.state === "claimed") {
    const result: AccountClaimResult = {
      ...publicAccount,
      status: "already_claimed",
      reason: "ALREADY_CLAIMED",
    };
    await writeLedger(store, ledgerKey, result, cycle.ledgerTtlSeconds);
    return result;
  }
  if (targetState.state === "unverified") {
    return {
      ...publicAccount,
      status: "ineligible",
      reason: "ITEM_NOT_VERIFIED",
    };
  }
  if (targetState.state !== "available") {
    return {
      ...publicAccount,
      status: "ineligible",
      reason: "ITEM_NOT_AVAILABLE",
    };
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
  try {
    purchaseSent = true;
    await startFreePurchase(
      session.dominations,
      account.gameAccountId,
      target,
      fetchImplementation,
    );

    let result: AccountClaimResult;
    try {
      const refreshedProducts = await getProductsForAccount(
        session.dominations,
        account.gameAccountId,
        fetchImplementation,
      );
      const refreshedTarget = findTargetProduct(refreshedProducts);
      const refreshedState = getProductState(refreshedTarget);
      const stockDecreased =
        target.stockAvailable !== null &&
        refreshedTarget?.stockAvailable !== null &&
        refreshedTarget?.stockAvailable !== undefined &&
        refreshedTarget.stockAvailable < target.stockAvailable;
      const confirmed =
        refreshedState.state === "claimed" ||
        refreshedState.state === "unavailable" ||
        stockDecreased;

      result = confirmed
        ? { ...publicAccount, status: "success", reason: "CONFIRMED" }
        : {
            ...publicAccount,
            status: "uncertain",
            reason: "POST_PURCHASE_UNCONFIRMED",
          };
    } catch {
      result = {
        ...publicAccount,
        status: "uncertain",
        reason: "POST_PURCHASE_UNCONFIRMED",
      };
    }

    await writeLedger(store, ledgerKey, result, cycle.ledgerTtlSeconds);
    durableOutcomeRecorded = true;
    return result;
  } catch (error) {
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
          status: purchaseSent ? "uncertain" : "failed",
          reason: purchaseSent
            ? "POST_PURCHASE_UNCONFIRMED"
            : "UPSTREAM_BEFORE_PURCHASE",
        };

    await writeLedger(store, ledgerKey, result, cycle.ledgerTtlSeconds);
    durableOutcomeRecorded = true;
    return result;
  } finally {
    if (!purchaseSent || durableOutcomeRecorded) {
      await store.compareDelete(accountLockKey, accountOwner).catch(() => false);
    }
  }
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
      status: result.status,
      reason: result.reason,
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
