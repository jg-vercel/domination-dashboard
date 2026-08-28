import { describe, expect, it, vi } from "vitest";

import type { AppSession } from "@/lib/auth/session";
import type { ClaimStore } from "@/lib/idempotency/redis-rest";

import {
  BatchClaimInProgressError,
  claimFreeLegendaryTokenForAllAccounts,
} from "./service";

const accountIds = [
  "game-account-0001",
  "game-account-0002",
  "game-account-0003",
];

const session: AppSession = {
  issuedAt: 1_000,
  expiresAt: 9_999_999_999,
  admin: {
    subject: "google-admin-subject",
    email: "admin@example.com",
    name: "Admin",
  },
  dominations: {
    accessToken: "dominations-bearer",
    cookies: ["domi=session"],
    userId: "user-1",
    xsollaId: "xsolla-1",
  },
  claimCsrfToken: "claim-csrf-token",
};

describe("three-account claim service", () => {
  it("processes accounts sequentially and distinguishes success/claimed/ineligible", async () => {
    const store = new MemoryClaimStore();
    const { fetchMock, purchaseAccounts } = createClaimFetch();
    let ownerIndex = 0;

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store,
      fetchImplementation: fetchMock,
      now: new Date("2026-08-28T00:00:00.000Z"),
      createOwnerToken: () => `owner-${++ownerIndex}`,
    });

    expect(result.cycle.id).toBe("2026-08-28");
    expect(result.results).toEqual([
      expect.objectContaining({
        accountName: "Commander 1",
        maskedAccountId: "••••0001",
        status: "success",
        reason: "CONFIRMED",
      }),
      expect.objectContaining({
        accountName: "Commander 2",
        status: "already_claimed",
      }),
      expect.objectContaining({
        accountName: "Commander 3",
        status: "ineligible",
        reason: "ITEM_NOT_VERIFIED",
      }),
    ]);
    expect(result.summary).toMatchObject({
      success: 1,
      already_claimed: 1,
      ineligible: 1,
    });
    expect(result.auditRecorded).toBe(true);
    expect(purchaseAccounts).toEqual([accountIds[0]]);
    expect([...store.values.keys()].join(" ")).not.toContain("game-account");
    expect(JSON.stringify(result)).not.toContain("dominations-bearer");
    expect(JSON.stringify(result)).not.toContain("free-token-sku");
  });

  it("uses durable cycle ledger results to block a repeated batch", async () => {
    const store = new MemoryClaimStore();
    const { fetchMock, purchaseAccounts } = createClaimFetch();
    const dependencies = {
      store,
      fetchImplementation: fetchMock,
      now: new Date("2026-08-28T00:00:00.000Z"),
      createOwnerToken: () => "owner",
    };

    await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(second.results.map((result) => result.status)).toEqual([
      "duplicate",
      "duplicate",
      "ineligible",
    ]);
    expect(purchaseAccounts).toEqual([accountIds[0]]);
  });

  it("sends purchase requests for three eligible accounts strictly in account order", async () => {
    const store = new MemoryClaimStore();
    const { fetchMock, purchaseAccounts } = createClaimFetch({ allAvailable: true });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store,
      fetchImplementation: fetchMock,
      now: new Date("2026-08-28T00:00:00.000Z"),
      createOwnerToken: () => "owner",
    });

    expect(purchaseAccounts).toEqual(accountIds);
    expect(result.results.map((item) => item.status)).toEqual([
      "success",
      "success",
      "success",
    ]);
  });

  it("blocks the whole batch when an atomic batch lock already exists", async () => {
    const store = new MemoryClaimStore();
    store.failNextSetNx = true;

    await expect(
      claimFreeLegendaryTokenForAllAccounts(session, {
        store,
        fetchImplementation: createClaimFetch().fetchMock,
        now: new Date("2026-08-28T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(BatchClaimInProgressError);
  });

  it("records an uncertain result when post-purchase confirmation fails", async () => {
    const store = new MemoryClaimStore();
    const { fetchMock } = createClaimFetch({ failAccountOnePostCheck: true });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store,
      fetchImplementation: fetchMock,
      now: new Date("2026-08-28T00:00:00.000Z"),
      createOwnerToken: () => "owner",
    });

    expect(result.results[0]).toMatchObject({
      status: "uncertain",
      reason: "POST_PURCHASE_UNCONFIRMED",
    });
    expect([...store.values.values()].some((value) => value.includes("uncertain"))).toBe(
      true,
    );
  });

  it("retains the long account lock when ledger persistence fails after purchase", async () => {
    const store = new MemoryClaimStore();
    store.failLedgerWrites = true;

    await expect(
      claimFreeLegendaryTokenForAllAccounts(session, {
        store,
        fetchImplementation: createClaimFetch().fetchMock,
        now: new Date("2026-08-28T00:00:00.000Z"),
        createOwnerToken: () => "owner",
      }),
    ).rejects.toThrow("ledger write failed");

    expect(
      [...store.values.keys()].some((key) => key.includes(":account:")),
    ).toBe(true);
  });
});

class MemoryClaimStore implements ClaimStore {
  readonly values = new Map<string, string>();
  readonly lists = new Map<string, string[]>();
  failNextSetNx = false;
  failLedgerWrites = false;

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string) {
    if (this.failLedgerWrites && key.includes(":ledger:")) {
      throw new Error("ledger write failed");
    }
    this.values.set(key, value);
  }

  async setNx(key: string, value: string) {
    if (this.failNextSetNx) {
      this.failNextSetNx = false;
      return false;
    }
    if (this.values.has(key)) return false;
    this.values.set(key, value);
    return true;
  }

  async compareDelete(key: string, owner: string) {
    if (this.values.get(key) !== owner) return false;
    this.values.delete(key);
    return true;
  }

  async appendList(key: string, value: string, maxItems: number) {
    const values = [value, ...(this.lists.get(key) ?? [])].slice(0, maxItems);
    this.lists.set(key, values);
  }

  async listRange(key: string, start: number, stop: number) {
    return (this.lists.get(key) ?? []).slice(start, stop + 1);
  }
}

function createClaimFetch({
  failAccountOnePostCheck = false,
  allAvailable = false,
}: {
  failAccountOnePostCheck?: boolean;
  allAvailable?: boolean;
} = {}) {
  const productReads = new Map<string, number>();
  const purchaseAccounts: string[] = [];
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/gameident/dom/list")) {
      return Response.json({ gameIds: accountIds });
    }
    if (url.endsWith("/api/dominations/linked_user_info")) {
      return Response.json({
        accounts: accountIds.map((gameAccountId, index) => ({
          gameAccountId,
          name: `Commander ${index + 1}`,
          age: 12 + index,
          trophies: 1_000 + index,
        })),
      });
    }

    const body = JSON.parse(String(init?.body)) as {
      gameAccountId: string;
    };
    if (url.endsWith("/api/xsollastore/startpurchase")) {
      purchaseAccounts.push(body.gameAccountId);
      return Response.json({ orderAccessToken: "free" });
    }

    const readCount = (productReads.get(body.gameAccountId) ?? 0) + 1;
    productReads.set(body.gameAccountId, readCount);
    if (
      failAccountOnePostCheck &&
      body.gameAccountId === accountIds[0] &&
      readCount === 2
    ) {
      return new Response("private error", { status: 503 });
    }

    const index = accountIds.indexOf(body.gameAccountId);
    const confirmedAfterPurchase = (allAvailable || index === 0) && readCount > 1;
    const accountTwoClaimed = !allAvailable && index === 1;
    const stockAvailable = confirmedAfterPurchase || accountTwoClaimed ? 0 : 1;
    const product = {
      name: "Free Legendary Token",
      google: `free-token-sku-${index}`,
      offerId: `free-token-offer-${index}`,
      price: 0,
      currency: "USD",
      is_free: true,
      stockAvailable,
      stockMax: 1,
      noInventory: false,
      disabled: false,
      locked: false,
      refresh: stockAvailable === 0 ? 3_600 : 0,
      tags: !allAvailable && index === 2 ? [] : ["WEB_SPECIALS"],
    };
    return Response.json(JSON.stringify([product]));
  });

  return { fetchMock, purchaseAccounts };
}
