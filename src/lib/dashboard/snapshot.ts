import "server-only";

import { AuthError } from "@/lib/auth/errors";
import type { DomiNationsCredential } from "@/lib/auth/session";
import {
  getLinkedAccounts,
  getProductsForAccount,
  listGameAccountIds,
  type DomiNationsAccount,
  type StoreProduct,
} from "@/lib/dominations/client";

export const TARGET_PRODUCT_NAME = "Free Legendary Token";

export type ProductState =
  | "available"
  | "claimed"
  | "unavailable"
  | "unverified"
  | "missing";

export interface DashboardAccount {
  maskedId: string;
  name: string;
  age: number | null;
  trophies: number | null;
  product: {
    state: ProductState;
    sectionVerified: boolean;
    isFree: boolean;
    stockAvailable: number | null;
    stockMax: number | null;
    refreshSeconds: number | null;
  };
}

export interface DashboardSnapshot {
  ready: boolean;
  accountCount: number;
  accounts: DashboardAccount[];
  checkedAt: string;
}

export async function loadAccountDirectory(
  credentials: DomiNationsCredential,
  fetchImplementation: typeof fetch = fetch,
): Promise<DomiNationsAccount[]> {
  const [gameIds, accounts] = await Promise.all([
    listGameAccountIds(credentials, fetchImplementation),
    getLinkedAccounts(credentials, fetchImplementation),
  ]);
  const listedIds = new Set(gameIds);
  const linkedIds = new Set(accounts.map((account) => account.gameAccountId));

  if (
    accounts.length !== 3 ||
    linkedIds.size !== 3 ||
    listedIds.size !== 3 ||
    [...linkedIds].some((id) => !listedIds.has(id))
  ) {
    throw new AuthError("ACCOUNT_COUNT_MISMATCH");
  }

  return accounts;
}

export async function loadDashboardSnapshot(
  credentials: DomiNationsCredential,
  fetchImplementation: typeof fetch = fetch,
): Promise<DashboardSnapshot> {
  const accounts = await loadAccountDirectory(credentials, fetchImplementation);
  const productsByAccount = await Promise.all(
    accounts.map((account) =>
      getProductsForAccount(
        credentials,
        account.gameAccountId,
        fetchImplementation,
      ),
    ),
  );
  const publicAccounts = accounts.map((account, index) =>
    createDashboardAccount(account, productsByAccount[index] ?? []),
  );

  return {
    ready: publicAccounts.every(
      (account) =>
        account.product.state !== "unverified" &&
        account.product.state !== "missing",
    ),
    accountCount: publicAccounts.length,
    accounts: publicAccounts,
    checkedAt: new Date().toISOString(),
  };
}

export function findTargetProduct(products: StoreProduct[]): StoreProduct | null {
  return (
    products.find(
      (product) =>
        product.name.trim().toLowerCase() === TARGET_PRODUCT_NAME.toLowerCase(),
    ) ?? null
  );
}

export function getProductState(product: StoreProduct | null): {
  state: ProductState;
  sectionVerified: boolean;
  isFree: boolean;
  stockAvailable: number | null;
  stockMax: number | null;
  refreshSeconds: number | null;
} {
  if (!product) {
    return {
      state: "missing",
      sectionVerified: false,
      isFree: false,
      stockAvailable: null,
      stockMax: null,
      refreshSeconds: null,
    };
  }

  const sectionVerified = product.tags.includes("AdditionalSpecials");
  const isFree = product.isFree || product.price === 0;
  const hasStock =
    product.stockMax === 0 ||
    product.stockMax === null ||
    (product.stockAvailable !== null && product.stockAvailable > 0);
  let state: ProductState;

  if (!sectionVerified || !isFree || !product.sku || !product.offerId) {
    state = "unverified";
  } else if (product.disabled || product.locked || product.noInventory) {
    state = "unavailable";
  } else if (!hasStock && (product.refreshSeconds ?? 0) > 0) {
    state = "claimed";
  } else if (hasStock) {
    state = "available";
  } else {
    state = "unavailable";
  }

  return {
    state,
    sectionVerified,
    isFree,
    stockAvailable: product.stockAvailable,
    stockMax: product.stockMax,
    refreshSeconds: product.refreshSeconds,
  };
}

function createDashboardAccount(
  account: DomiNationsAccount,
  products: StoreProduct[],
): DashboardAccount {
  return {
    maskedId: maskAccountId(account.gameAccountId),
    name: account.name,
    age: account.age,
    trophies: account.trophies,
    product: getProductState(findTargetProduct(products)),
  };
}

function maskAccountId(value: string): string {
  const suffix = value.slice(-4);
  return `••••${suffix}`;
}
