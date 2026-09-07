import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("all-account claim service", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
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
        reason: "FREE_PURCHASE_ACCEPTED",
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
      "success",
      "already_claimed",
      "ineligible",
    ]);
    expect(second.results.slice(0, 2).every((result) => result.replayed)).toBe(true);
    expect(purchaseAccounts).toEqual([accountIds[0]]);
  });

  it.each(["free-token-offer-0", ""])("claims the exact Free Legendary Token! with offer ID %j among paid Legendary specials", async (offerId) => {
    const additionalProducts = [
      "Small Legendary Token Special!", "Medium Legendary Token Special!", "Large Legendary Token Special!",
      "2X Small Legendary Token Special!", "2X Medium Legendary Token Special!", "2X Large Legendary Token Special!",
    ].map((name, index) => ({
      name, google: `paid-sku-${index}`, offerId: `paid-offer-${index}`, price: 9.99,
      is_free: false, stockAvailable: 1, stockMax: 1, tags: ["AdditionalSpecials"],
    }));
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true, ids: [accountIds[0]!], targetName: "Free Legendary Token!", additionalProducts,
      targetOverride: { offerId },
    });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store: new MemoryClaimStore(), fetchImplementation: fetchMock,
      now: new Date("2026-08-28T00:00:00.000Z"), createOwnerToken: () => "owner",
    });

    expect(purchaseAccounts).toEqual([accountIds[0]]);
    expect(result.results).toEqual([expect.objectContaining({ status: "success", reason: "FREE_PURCHASE_ACCEPTED" })]);
    const purchases = fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/startpurchase"));
    expect(purchases).toHaveLength(1);
    expect(JSON.parse(String(purchases[0]?.[1]?.body))).toMatchObject({
      itemSku: "free-token-sku-0", offerId, quantity: 1,
    });
  });

  it.each([
    { override: { google: "" }, reason: "ITEM_NOT_VERIFIED" },
    { override: { price: 9.99, is_free: false }, reason: "ITEM_NOT_VERIFIED" },
    { override: { disabled: 1 }, reason: "ITEM_NOT_AVAILABLE" },
    { override: { noInventory: 1 }, reason: "ITEM_NOT_AVAILABLE" },
    { override: { locked: 1 }, reason: "ITEM_NOT_AVAILABLE" },
    { override: { tags: ["OtherSection"] }, reason: "ITEM_NOT_VERIFIED" },
  ])("does not purchase the exact bang title with empty offer ID when safety checks fail: %j", async ({ override, reason }) => {
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true, ids: [accountIds[0]!], targetName: "Free Legendary Token!", targetOverride: { offerId: "", ...override },
    });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store: new MemoryClaimStore(), fetchImplementation: fetchMock,
      now: new Date("2026-08-28T00:00:00.000Z"), createOwnerToken: () => "owner",
    });

    expect(result.results).toEqual([expect.objectContaining({ status: "ineligible", reason })]);
    expect(purchaseAccounts).toEqual([]);
  });

  it.each([
    ["Free Legendary Token", "Free Legendary Token!"],
    ["Free Legendary Token!", "Free Legendary Token"],
  ])("reuses the same cycle ledger when the title changes from %s to %s", async (firstName, secondName) => {
    const store = new MemoryClaimStore();
    const firstFetch = createClaimFetch({ allAvailable: true, ids: [accountIds[0]!], targetName: firstName });
    const secondFetch = createClaimFetch({ allAvailable: true, ids: [accountIds[0]!], targetName: secondName });
    const dependencies = { store, now: new Date("2026-08-28T00:00:00.000Z"), createOwnerToken: () => "owner" };

    const firstResult = await claimFreeLegendaryTokenForAllAccounts(session, { ...dependencies, fetchImplementation: firstFetch.fetchMock });
    const secondResult = await claimFreeLegendaryTokenForAllAccounts(session, { ...dependencies, fetchImplementation: secondFetch.fetchMock });

    expect(firstResult.summary.success).toBe(1);
    expect(secondResult.results).toEqual([expect.objectContaining({ status: "success", reason: "FREE_PURCHASE_ACCEPTED", replayed: true })]);
    expect(firstFetch.purchaseAccounts).toEqual([accountIds[0]]);
    expect(secondFetch.purchaseAccounts).toEqual([]);
    expect([...store.values.keys()].filter((key) => key.includes(":ledger:"))).toHaveLength(1);
  });

  it.each([0, 1, 2, 4, 6])("sends purchase requests for all %i eligible accounts strictly in account order", async (count) => {
    const store = new MemoryClaimStore();
    const ids = Array.from({ length: count }, (_, index) => `game-account-${index}`);
    const { fetchMock, purchaseAccounts } = createClaimFetch({ allAvailable: true, ids });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store,
      fetchImplementation: fetchMock,
      now: new Date("2026-08-28T00:00:00.000Z"),
      createOwnerToken: () => "owner",
    });

    expect(purchaseAccounts).toEqual(ids);
    expect(result.results.map((item) => item.status)).toEqual(ids.map(() => "success"));
    expect(result.summary.success).toBe(count);
    if (count === 0) expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("claims each account in the union once, including accounts found in only one source", async () => {
    const ids = ["direct-only", "shared", "linked-only"];
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true,
      ids,
      listedIds: ["direct-only", "shared"],
      linkedIds: ["shared", "linked-only"],
    });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store: new MemoryClaimStore(),
      fetchImplementation: fetchMock,
      now: new Date("2026-08-28T00:00:00.000Z"),
      createOwnerToken: () => "owner",
    });

    expect(purchaseAccounts).toEqual(ids);
    expect(result.summary.success).toBe(3);
    expect(result.results).toHaveLength(3);
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

  it("accepts the free acknowledgement without making a failing post-purchase catalog read", async () => {
    const store = new MemoryClaimStore();
    const { fetchMock, productReads } = createClaimFetch({ failAccountOnePostCheck: true });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store,
      fetchImplementation: fetchMock,
      now: new Date("2026-08-28T00:00:00.000Z"),
      createOwnerToken: () => "owner",
    });

    expect(result.results[0]).toMatchObject({
      status: "success",
      reason: "FREE_PURCHASE_ACCEPTED",
    });
    expect(productReads.get(accountIds[0]!)).toBe(1);
    expect(JSON.parse(store.values.get(ledgerKey(accountIds[0]!))!)).toMatchObject({
      version: 2, status: "success", reason: "FREE_PURCHASE_ACCEPTED",
    });
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

  it("retries only an explicitly rejected account, preserving successful and uncertain outcomes", async () => {
    const store = new MemoryClaimStore();
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true,
      onPurchase: (id, attempt) => {
        if (id === accountIds[1] && attempt === 1) {
          return Response.json({ success: false, failreason: "UnableToProcess" });
        }
        if (id === accountIds[2]) throw new Error("private upstream token");
        return Response.json({ success: true, orderAccessToken: "free" });
      },
    });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z") };

    const first = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    expect(first.results.map(({ status, reason }) => ({ status, reason }))).toEqual([
      { status: "success", reason: "FREE_PURCHASE_ACCEPTED" },
      { status: "failed", reason: "STORE_PURCHASE_REJECTED" },
      { status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED" },
    ]);
    expect(JSON.parse(store.values.get(ledgerKey(accountIds[1]!))!)).toMatchObject({
      version: 2, status: "failed", reason: "STORE_PURCHASE_REJECTED",
    });
    expect(JSON.parse(store.values.get(ledgerKey(accountIds[2]!))!)).toMatchObject({
      version: 2, status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED",
    });
    expect([...store.values.keys()].some((key) => key.includes(":account:"))).toBe(false);

    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    expect(second.results).toEqual([
      expect.objectContaining({ status: "success", reason: "FREE_PURCHASE_ACCEPTED", replayed: true }),
      expect.objectContaining({ status: "success", reason: "FREE_PURCHASE_ACCEPTED" }),
      expect.objectContaining({ status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED", replayed: true }),
    ]);
    expect(second.results[1]?.replayed).toBeUndefined();
    expect(purchaseAccounts).toEqual([...accountIds, accountIds[1]]);
    const diagnostics = JSON.stringify([console.info, console.warn].flatMap((fn) => vi.mocked(fn).mock.calls));
    for (const secret of [...accountIds, session.admin.subject, "private upstream token", "dominations-bearer", "domi=session"]) {
      expect(diagnostics).not.toContain(secret);
    }
    const audits = [...store.lists.values()].flat().map((value) => JSON.parse(value));
    expect(audits[1].results[1]).toMatchObject({ status: "failed", reason: "STORE_PURCHASE_REJECTED" });
  });

  it.each(["SoldOut", "SoldOutWithRefresh"])("preserves the explicit %s limit without resending", async (failreason) => {
    const store = new MemoryClaimStore();
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true, ids: [accountIds[0]!],
      onPurchase: () => Response.json({ success: false, failreason }),
    });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z") };
    const first = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    expect(first.results[0]).toMatchObject({ status: "ineligible", reason: "STORE_PURCHASE_LIMIT" });
    expect(second.results[0]).toMatchObject({ status: "ineligible", reason: "STORE_PURCHASE_LIMIT", replayed: true });
    expect(purchaseAccounts).toEqual([accountIds[0]]);
  });

  it("retains the account lock if the terminal purchase-limit ledger cannot be saved", async () => {
    const store = new MemoryClaimStore();
    store.failLedgerWrites = true;
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true, ids: [accountIds[0]!],
      onPurchase: () => Response.json({ success: false, failreason: "SoldOut" }),
    });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z") };
    await expect(claimFreeLegendaryTokenForAllAccounts(session, dependencies)).rejects.toThrow("ledger write failed");
    expect([...store.values.keys()].some((key) => key.includes(":account:"))).toBe(true);
    store.failLedgerWrites = false;
    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    expect(second.results[0]).toMatchObject({ status: "duplicate", reason: "ACCOUNT_IN_PROGRESS" });
    expect(purchaseAccounts).toEqual([accountIds[0]]);
  });

  it.each(["InvalidItem", "UnknownItem", "ItemNotAvailable"])("allows manual rechecking after explicit %s rejection", async (failreason) => {
    const store = new MemoryClaimStore();
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true, ids: [accountIds[0]!],
      onPurchase: (_id, attempt) => Response.json(attempt === 1
        ? { success: false, failreason }
        : { orderAccessToken: "free" }),
    });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z") };
    const first = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    expect(first.results[0]).toMatchObject({ status: "failed", reason: "STORE_ITEM_UNAVAILABLE" });
    expect(second.results[0]?.status).toBe("success");
    expect(purchaseAccounts).toEqual([accountIds[0], accountIds[0]]);
  });

  it.each([
    { record: JSON.stringify({ status: "success", reason: "CONFIRMED" }), status: "success", reason: "CONFIRMED" },
    { record: JSON.stringify({ status: "already_claimed", reason: "ALREADY_CLAIMED" }), status: "already_claimed", reason: "ALREADY_CLAIMED" },
    { record: JSON.stringify({ version: 2, status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED" }), status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED" },
    { record: JSON.stringify({ version: 2, status: "uncertain", reason: "POST_PURCHASE_UNCONFIRMED" }), status: "uncertain", reason: "POST_PURCHASE_UNCONFIRMED" },
    { record: JSON.stringify({ version: null, status: "uncertain", reason: "POST_PURCHASE_UNCONFIRMED" }), status: "uncertain", reason: "POST_PURCHASE_UNCONFIRMED" },
    { record: JSON.stringify({ version: 0, status: "uncertain", reason: "POST_PURCHASE_UNCONFIRMED" }), status: "uncertain", reason: "POST_PURCHASE_UNCONFIRMED" },
    { record: JSON.stringify({ version: 3, status: "uncertain", reason: "POST_PURCHASE_UNCONFIRMED" }), status: "uncertain", reason: "POST_PURCHASE_UNCONFIRMED" },
    { record: JSON.stringify({ status: "failed", reason: "STORE_PURCHASE_REJECTED" }), status: "uncertain", reason: "PREVIOUS_OUTCOME_UNKNOWN" },
    { record: JSON.stringify({ version: 3, status: "failed", reason: "STORE_PURCHASE_REJECTED" }), status: "uncertain", reason: "PREVIOUS_OUTCOME_UNKNOWN" },
    { record: JSON.stringify({ status: "ineligible", reason: "STORE_PURCHASE_LIMIT" }), status: "ineligible", reason: "STORE_PURCHASE_LIMIT" },
    { record: JSON.stringify({ status: "ineligible", reason: "PAID_TOKEN_REJECTED" }), status: "ineligible", reason: "PAID_TOKEN_REJECTED" },
    { record: "not-json", status: "uncertain", reason: "PREVIOUS_OUTCOME_UNKNOWN" },
    { record: "null", status: "uncertain", reason: "PREVIOUS_OUTCOME_UNKNOWN" },
    { record: "{}", status: "uncertain", reason: "PREVIOUS_OUTCOME_UNKNOWN" },
    { record: JSON.stringify({ status: "success", reason: "private arbitrary text" }), status: "uncertain", reason: "PREVIOUS_OUTCOME_UNKNOWN" },
    { record: JSON.stringify({ status: "failed", reason: "UPSTREAM_BEFORE_PURCHASE" }), status: "uncertain", reason: "PREVIOUS_OUTCOME_UNKNOWN" },
  ])("preserves legacy/unknown ledger without purchase: $record", async ({ record, status, reason }) => {
    const store = new MemoryClaimStore();
    store.values.set(ledgerKey(accountIds[0]!), record);
    const { fetchMock, purchaseAccounts } = createClaimFetch({ allAvailable: true, ids: [accountIds[0]!] });
    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z"),
    });
    expect(result.results[0]).toMatchObject({ status, reason, replayed: true });
    expect(purchaseAccounts).toEqual([]);
    expect(store.values.get(ledgerKey(accountIds[0]!))).toBe(record);
    expect(JSON.stringify(result)).not.toContain("private arbitrary text");
  });

  it.each([429, 500])("does not resend a purchase after HTTP %i with unknown outcome", async (status) => {
    const store = new MemoryClaimStore();
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true, ids: [accountIds[0]!],
      onPurchase: () => new Response("private response", { status }),
    });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z") };
    await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    expect(second.results[0]).toMatchObject({ status: "uncertain", replayed: true });
    expect(purchaseAccounts).toEqual([accountIds[0]]);
  });

  it.each([
    { disabled: true, stockAvailable: 1, refresh: 0 },
    { locked: true, stockAvailable: 1, refresh: 0 },
    { google: "a-different-product", stockAvailable: 0, refresh: 3600 },
    { stockAvailable: 1, refresh: 0 },
  ])("uses the official acknowledgement without depending on later inventory: %j", async (postPurchaseOverride) => {
    const store = new MemoryClaimStore();
    const { fetchMock, purchaseAccounts, productReads } = createClaimFetch({
      allAvailable: true, ids: [accountIds[0]!], postPurchaseOverride,
    });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z") };
    const first = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    expect(first.results[0]).toMatchObject({ status: "success", reason: "FREE_PURCHASE_ACCEPTED" });
    expect(second.results[0]).toMatchObject({ status: "success", reason: "FREE_PURCHASE_ACCEPTED", replayed: true });
    expect(purchaseAccounts).toEqual([accountIds[0]]);
    expect(productReads.get(accountIds[0]!)).toBe(1);
  });

  it("rechecks the completed ledger after acquiring the account lock", async () => {
    const store = new MemoryClaimStore();
    const originalSetNx = store.setNx.bind(store);
    vi.spyOn(store, "setNx").mockImplementation(async (key, owner) => {
      if (key.includes(":account:")) {
        store.values.set(ledgerKey(accountIds[0]!), JSON.stringify({ status: "success", reason: "CONFIRMED" }));
      }
      return originalSetNx(key, owner);
    });
    const { fetchMock, purchaseAccounts } = createClaimFetch({ allAvailable: true, ids: [accountIds[0]!] });
    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z"),
    });
    expect(result.results[0]).toMatchObject({ status: "success", replayed: true });
    expect(purchaseAccounts).toEqual([]);
    expect([...store.values.keys()].some((key) => key.includes(":account:"))).toBe(false);
  });

  it("recovers three legacy unknown accounts in one batch while retaining the previously successful fourth account", async () => {
    const store = new MemoryClaimStore();
    const ids = ["game-account-0000", ...accountIds];
    const priorSuccess = JSON.stringify({ status: "success", reason: "CONFIRMED", recordedAt: "2026-08-28T00:01:00Z" });
    store.values.set(ledgerKey(ids[0]!), priorSuccess);
    const originals = accountIds.map((id, index) => {
      const original = JSON.stringify({ status: "uncertain", reason: "POST_PURCHASE_UNCONFIRMED", recordedAt: `2026-08-28T00:0${index + 2}:00Z` });
      store.values.set(ledgerKey(id), original);
      return original;
    });
    const { fetchMock, purchaseAccounts, productReads } = createClaimFetch({ allAvailable: true, ids });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z") };

    const first = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(first.results[0]).toMatchObject({ status: "success", reason: "CONFIRMED", replayed: true });
    expect(first.results.slice(1)).toEqual(accountIds.map(() => expect.objectContaining({
      status: "success", reason: "FREE_PURCHASE_ACCEPTED", recovered: true,
    })));
    expect(first.summary.success).toBe(4);
    expect(purchaseAccounts).toEqual(accountIds);
    expect(productReads.has(ids[0]!)).toBe(false);
    for (const [index, id] of accountIds.entries()) {
      expect(productReads.get(id)).toBe(1);
      expect(JSON.parse(store.values.get(recoveryKey(id))!)).toEqual({ version: 2, state: "in_flight", previousRecord: originals[index] });
      expect(JSON.parse(store.values.get(ledgerKey(id))!)).toMatchObject({ version: 2, status: "success", reason: "FREE_PURCHASE_ACCEPTED", recovered: true });
    }
    expect(store.values.get(ledgerKey(ids[0]!))).toBe(priorSuccess);

    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(second.results.every((result) => result.status === "success" && result.replayed)).toBe(true);
    expect(purchaseAccounts).toEqual(accountIds);
    expect([...store.values.keys()].filter((key) => key.includes(":recovery:"))).toHaveLength(3);
    expect(JSON.stringify(second)).not.toContain("previousRecord");
  });

  it.each([
    { disabled: true },
    { locked: true },
    { stockAvailable: 0, refresh: 3600 },
    { tags: [] },
    { name: "A different free gift" },
  ])("preserves legacy evidence without a purchase when the current item is unavailable: %j", async (targetOverride) => {
    const store = new MemoryClaimStore();
    const original = legacyUnknownRecord();
    store.values.set(ledgerKey(accountIds[0]!), original);
    const { fetchMock, purchaseAccounts } = createClaimFetch({ allAvailable: true, ids: [accountIds[0]!], targetOverride });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z") };

    const result = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(result.results[0]).toMatchObject({ status: "uncertain", reason: "LEGACY_RECOVERY_UNAVAILABLE", replayed: true });
    expect(store.values.get(ledgerKey(accountIds[0]!))).toBe(original);
    expect(store.values.has(recoveryKey(accountIds[0]!))).toBe(false);
    expect(purchaseAccounts).toEqual([]);
  });

  it("keeps a failed legacy catalog query uncertain without starting recovery", async () => {
    const store = new MemoryClaimStore();
    const original = legacyUnknownRecord();
    store.values.set(ledgerKey(accountIds[0]!), original);
    const { fetchMock, purchaseAccounts } = createClaimFetch({ allAvailable: true, ids: [accountIds[0]!], failProductReads: true });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z"),
    });

    expect(result.results[0]).toMatchObject({ status: "uncertain", reason: "LEGACY_RECOVERY_UNAVAILABLE", replayed: true });
    expect(store.values.get(ledgerKey(accountIds[0]!))).toBe(original);
    expect(store.values.has(recoveryKey(accountIds[0]!))).toBe(false);
    expect(purchaseAccounts).toEqual([]);
  });

  it("does not send when a recovery marker already exists", async () => {
    const store = new MemoryClaimStore();
    const original = legacyUnknownRecord();
    const marker = JSON.stringify({ version: 2, state: "in_flight", previousRecord: original });
    store.values.set(ledgerKey(accountIds[0]!), original);
    store.values.set(recoveryKey(accountIds[0]!), marker);
    const { fetchMock, purchaseAccounts, productReads } = createClaimFetch({ allAvailable: true, ids: [accountIds[0]!] });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z"),
    });

    expect(result.results[0]).toMatchObject({ status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED", replayed: true });
    expect(purchaseAccounts).toEqual([]);
    expect(productReads.size).toBe(0);
    expect(store.values.get(ledgerKey(accountIds[0]!))).toBe(original);
    expect(store.values.get(recoveryKey(accountIds[0]!))).toBe(marker);
  });

  it("does not send when another attempt wins the atomic recovery marker", async () => {
    const store = new MemoryClaimStore();
    const original = legacyUnknownRecord();
    store.values.set(ledgerKey(accountIds[0]!), original);
    const originalSetNx = store.setNx.bind(store);
    vi.spyOn(store, "setNx").mockImplementation(async (key, value) => {
      if (key.includes(":recovery:")) {
        store.values.set(key, "marker-from-another-attempt");
      }
      return originalSetNx(key, value);
    });
    const { fetchMock, purchaseAccounts } = createClaimFetch({ allAvailable: true, ids: [accountIds[0]!] });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z"),
    });

    expect(result.results[0]).toMatchObject({ status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED", replayed: true });
    expect(purchaseAccounts).toEqual([]);
    expect(store.values.get(ledgerKey(accountIds[0]!))).toBe(original);
    expect(store.values.get(recoveryKey(accountIds[0]!))).toBe("marker-from-another-attempt");
  });

  it("does not send or overwrite original evidence when marker persistence fails", async () => {
    const store = new MemoryClaimStore();
    store.failRecoveryMarkerWrites = true;
    const original = legacyUnknownRecord();
    store.values.set(ledgerKey(accountIds[0]!), original);
    const { fetchMock, purchaseAccounts } = createClaimFetch({ allAvailable: true, ids: [accountIds[0]!] });

    await expect(claimFreeLegendaryTokenForAllAccounts(session, {
      store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z"),
    })).rejects.toThrow("recovery marker write failed");

    expect(purchaseAccounts).toEqual([]);
    expect(store.values.get(ledgerKey(accountIds[0]!))).toBe(original);
    expect(store.values.has(recoveryKey(accountIds[0]!))).toBe(false);
    expect([...store.values.keys()].some((key) => key.includes(":account:"))).toBe(false);
  });

  it("retains the lock and original recovery evidence if acknowledgement persistence fails", async () => {
    const store = new MemoryClaimStore();
    const original = legacyUnknownRecord();
    store.values.set(ledgerKey(accountIds[0]!), original);
    const write = vi.spyOn(store, "set").mockRejectedValueOnce(new Error("ledger write failed"));
    const { fetchMock, purchaseAccounts } = createClaimFetch({ allAvailable: true, ids: [accountIds[0]!] });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z") };

    await expect(claimFreeLegendaryTokenForAllAccounts(session, dependencies)).rejects.toThrow("ledger write failed");

    expect(write).toHaveBeenCalledOnce();
    expect(store.values.get(ledgerKey(accountIds[0]!))).toBe(original);
    expect(JSON.parse(store.values.get(recoveryKey(accountIds[0]!))!)).toMatchObject({ previousRecord: original });
    const lock = [...store.values.keys()].find((key) => key.includes(":account:"));
    expect(lock).toBeDefined();
    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    expect(second.results[0]).toMatchObject({ status: "duplicate", reason: "ACCOUNT_IN_PROGRESS" });
    expect(purchaseAccounts).toEqual([accountIds[0]]);

    // Even loss/expiry of the transient account lock cannot repeat recovery.
    store.values.delete(lock!);
    const third = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    expect(third.results[0]).toMatchObject({ status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED", replayed: true });
    expect(purchaseAccounts).toEqual([accountIds[0]]);
  });

  it("does not repeat recovery after its purchase response is lost", async () => {
    const store = new MemoryClaimStore();
    const original = legacyUnknownRecord();
    store.values.set(ledgerKey(accountIds[0]!), original);
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true, ids: [accountIds[0]!], onPurchase: () => { throw new Error("response lost"); },
    });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z") };

    const first = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(first.results[0]).toMatchObject({ status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED", recovered: true });
    expect(second.results[0]).toMatchObject({ status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED", recovered: true, replayed: true });
    expect(JSON.parse(store.values.get(ledgerKey(accountIds[0]!))!)).toMatchObject({ version: 2, status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED" });
    expect(JSON.parse(store.values.get(recoveryKey(accountIds[0]!))!)).toMatchObject({ previousRecord: original });
    expect(purchaseAccounts).toEqual([accountIds[0]]);
  });

  it("starts at most one recovery when button requests overlap", async () => {
    const store = new MemoryClaimStore();
    store.values.set(ledgerKey(accountIds[0]!), legacyUnknownRecord());
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true, ids: [accountIds[0]!], onPurchase: () => { started.resolve(); return response.promise; },
    });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z") };
    const first = claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    await started.promise;

    await expect(claimFreeLegendaryTokenForAllAccounts(session, dependencies)).rejects.toBeInstanceOf(BatchClaimInProgressError);
    response.resolve(Response.json({ orderAccessToken: "free" }));
    expect((await first).results[0]).toMatchObject({ status: "success", recovered: true });
    const afterCompletion = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    expect(afterCompletion.results[0]).toMatchObject({ status: "success", replayed: true });
    expect(purchaseAccounts).toEqual([accountIds[0]]);
  });
});

function ledgerKey(id: string) {
  const hash = createHash("sha256").update(`${session.admin.subject}:${id}:Free Legendary Token`).digest("hex").slice(0, 24);
  return `domi:claim:ledger:2026-08-28:${hash}`;
}

function recoveryKey(id: string) {
  return ledgerKey(id).replace(":ledger:", ":recovery:");
}

function legacyUnknownRecord() {
  return JSON.stringify({ status: "uncertain", reason: "POST_PURCHASE_UNCONFIRMED", recordedAt: "2026-08-28T00:01:00Z" });
}

class MemoryClaimStore implements ClaimStore {
  readonly values = new Map<string, string>();
  readonly lists = new Map<string, string[]>();
  failNextSetNx = false;
  failLedgerWrites = false;
  failRecoveryMarkerWrites = false;

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
    if (this.failRecoveryMarkerWrites && key.includes(":recovery:")) {
      throw new Error("recovery marker write failed");
    }
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
  failProductReads = false,
  allAvailable = false,
  ids = accountIds,
  listedIds = ids,
  linkedIds = ids,
  targetName = "Free Legendary Token",
  targetOverride = {},
  additionalProducts = [],
  onPurchase,
  postPurchaseOverride = {},
}: {
  failAccountOnePostCheck?: boolean;
  failProductReads?: boolean;
  allAvailable?: boolean;
  ids?: string[];
  listedIds?: string[];
  linkedIds?: string[];
  targetName?: string;
  targetOverride?: Record<string, unknown>;
  additionalProducts?: Record<string, unknown>[];
  onPurchase?: (id: string, attempt: number) => Response | Promise<Response>;
  postPurchaseOverride?: Record<string, unknown>;
} = {}) {
  const productReads = new Map<string, number>();
  const purchaseAccounts: string[] = [];
  const completedAccounts = new Set<string>();
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/gameident/dom/list")) {
      return Response.json({ gameIds: Object.fromEntries(listedIds.map((id) => [id, {}])) });
    }
    if (url.endsWith("/api/dominations/linked_user_info")) {
      return Response.json({
        accounts: linkedIds.map((gameAccountId, index) => ({
          gameAccountId,
          name: `Commander ${index + 1}`,
          age: 12 + index,
          trophies: 1_000 + index,
        })),
      });
    }

    const userInfoPath = new URL(url).pathname.match(/^\/api\/dominations\/([^/]+)\/user_info$/);
    if (userInfoPath) {
      return Response.json({ name: `Direct ${decodeURIComponent(userInfoPath[1]!)}`, age: 15 });
    }

    const body = JSON.parse(String(init?.body)) as {
      gameAccountId: string;
    };
    if (url.endsWith("/api/xsollastore/startpurchase")) {
      purchaseAccounts.push(body.gameAccountId);
      const response = onPurchase
        ? await onPurchase(body.gameAccountId, purchaseAccounts.filter((id) => id === body.gameAccountId).length)
        : Response.json({ orderAccessToken: "free" });
      const payload = await response.clone().json().catch(() => null);
      if (response.ok && payload?.orderAccessToken === "free" && payload?.success !== false) completedAccounts.add(body.gameAccountId);
      return response;
    }

    const readCount = (productReads.get(body.gameAccountId) ?? 0) + 1;
    productReads.set(body.gameAccountId, readCount);
    if (failProductReads) return new Response("private error", { status: 503 });
    if (
      failAccountOnePostCheck &&
      body.gameAccountId === ids[0] &&
      readCount === 2
    ) {
      return new Response("private error", { status: 503 });
    }

    const index = ids.indexOf(body.gameAccountId);
    const confirmedAfterPurchase = completedAccounts.has(body.gameAccountId);
    const accountTwoClaimed = !allAvailable && index === 1;
    const stockAvailable = confirmedAfterPurchase || accountTwoClaimed ? 0 : 1;
    const product = {
      name: targetName,
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
      tags: !allAvailable && index === 2 ? [] : ["AdditionalSpecials"],
      ...targetOverride,
      ...(confirmedAfterPurchase ? postPurchaseOverride : {}),
    };
    return Response.json(JSON.stringify([...additionalProducts, product]));
  });

  return { fetchMock, purchaseAccounts, productReads };
}
