import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSession } from "@/lib/auth/session";
import type { ClaimStore } from "@/lib/idempotency/redis-rest";
import type { ClaimAuditEntry } from "./audit";

import {
  BatchClaimInProgressError,
  claimFreeLegendaryTokenForAllAccounts as runClaimService,
  type ClaimServiceDependencies,
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

  it.each([500, 502, 503])("does not resend a purchase after HTTP %i with unknown outcome", async (status) => {
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
    const originalSet = store.set.bind(store);
    const write = vi.spyOn(store, "set").mockImplementation(async (key, value) => {
      if (key.includes(":ledger:")) throw new Error("ledger write failed");
      return originalSet(key, value);
    });
    const { fetchMock, purchaseAccounts } = createClaimFetch({ allAvailable: true, ids: [accountIds[0]!] });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z") };

    await expect(claimFreeLegendaryTokenForAllAccounts(session, dependencies)).rejects.toThrow("ledger write failed");

    expect(write.mock.calls.filter(([key]) => key.includes(":ledger:"))).toHaveLength(1);
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

  it("completes all accounts with five-second spacing and bounded backoff after subsequent 429 responses", async () => {
    const time = createPacingClock();
    const attempts: Array<{ id: string; at: number }> = [];
    const { fetchMock, purchaseAccounts, productReads } = createClaimFetch({
      allAvailable: true,
      onPurchase: (id, attempt) => {
        attempts.push({ id, at: time.clock() });
        const reject = (id === accountIds[1] && attempt <= 2) || (id === accountIds[2] && attempt === 1);
        return reject ? new Response("rate limited", { status: 429 }) : Response.json({ orderAccessToken: "free" });
      },
    });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store: new MemoryClaimStore(), fetchImplementation: fetchMock,
      now: new Date("2026-08-28T00:00:00Z"), clock: time.clock, sleep: time.sleep,
    });

    expect(result.summary.success).toBe(3);
    expect(purchaseAccounts).toEqual([accountIds[0], accountIds[1], accountIds[1], accountIds[1], accountIds[2], accountIds[2]]);
    expect(attempts.map(({ at }) => at)).toEqual([0, 5_000, 15_000, 35_000, 40_000, 50_000]);
    expect(attempts.slice(1).every((attempt, index) => attempt.at - attempts[index]!.at >= 5_000)).toBe(true);
    expect(productReads.get(accountIds[0]!)).toBe(1);
    expect(productReads.get(accountIds[1]!)).toBe(3);
    expect(productReads.get(accountIds[2]!)).toBe(2);
  });

  it("honors a longer Retry-After before retrying and spaces the next account after success", async () => {
    const time = createPacingClock();
    const purchaseTimes: number[] = [];
    const { fetchMock } = createClaimFetch({
      allAvailable: true, ids: accountIds.slice(0, 2),
      onPurchase: (id, attempt) => {
        purchaseTimes.push(time.clock());
        return id === accountIds[0] && attempt === 1
          ? new Response("limited", { status: 429, headers: { "Retry-After": "12" } })
          : Response.json({ orderAccessToken: "free" });
      },
    });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store: new MemoryClaimStore(), fetchImplementation: fetchMock,
      now: new Date("2026-08-28T00:00:00Z"), clock: time.clock, sleep: time.sleep,
    });

    expect(result.summary.success).toBe(2);
    expect(purchaseTimes).toEqual([0, 12_000, 17_000]);
    expect(time.sleep.mock.calls.map(([ms]) => ms)).toEqual([12_000, 5_000]);
  });

  it.each([
    { order: [0, 1, 2, 3], completed: [] },
    { order: [0, 1, 2, 3], completed: [0] },
    { order: [3, 1, 0, 2], completed: [3, 1] },
    { order: [1, 3, 0, 2], completed: [0] },
  ])("handles the first eligible account, not a fixed directory index, with distinct refreshed products: %j", async ({ order, completed }) => {
    const allIds = [...accountIds, "game-account-0004"];
    const ids = order.map((index) => allIds[index]!);
    const completedIds = new Set(completed.map((index) => allIds[index]!));
    const eligibleIds = ids.filter((id) => !completedIds.has(id));
    const store = new MemoryClaimStore();
    for (const id of completedIds) {
      store.values.set(ledgerKey(id), JSON.stringify({
        version: 2, status: "success", reason: "FREE_PURCHASE_ACCEPTED",
        recordedAt: "2026-08-28T00:00:00Z",
      }));
    }
    const originals = new Map([...completedIds].map((id) => [id, store.values.get(ledgerKey(id))]));
    const time = createPacingClock();
    const catalogLatency = 250;
    const responseLatency = 700;
    const latestProducts = new Map<string, { google: string; offerId: string }>();
    const attempts: Array<{ id: string; startedAt: number; respondedAt: number; status: number; retryAfterMs: number }> = [];
    const { fetchMock, purchaseAccounts, productReads } = createClaimFetch({
      ids, allAvailable: true,
      onProductRead: (id, readCount) => {
        time.advance(catalogLatency);
        const product = {
          google: `own-sku-${id.slice(-4)}-revision-${readCount}`,
          offerId: Number(id.slice(-1)) % 2 === 0 ? "" : `own-offer-${id.slice(-4)}-revision-${readCount}`,
        };
        latestProducts.set(id, product);
        return product;
      },
      onPurchase: (id, accountAttempt, body) => {
        const product = latestProducts.get(id)!;
        expect(body).toMatchObject({ gameAccountId: id, itemSku: product.google, offerId: product.offerId, quantity: 1 });
        const startedAt = time.clock();
        time.advance(responseLatency);
        const rejected = id !== eligibleIds[0] && accountAttempt === 1;
        const retryAfterMs = eligibleIds.indexOf(id) % 2 === 1 ? 3_000 : 12_000;
        attempts.push({ id, startedAt, respondedAt: time.clock(), status: rejected ? 429 : 200, retryAfterMs });
        return rejected
          ? new Response("mock rate limit", { status: 429, headers: { "Retry-After": String(retryAfterMs / 1_000) } })
          : Response.json({ success: true, orderAccessToken: "free" });
      },
    });
    const dependencies = {
      store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z"),
      clock: time.clock, sleep: time.sleep,
    };

    const result = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    const expectedIds = eligibleIds.flatMap((id, index) => index === 0 ? [id] : [id, id]);
    expect(purchaseAccounts).toEqual(expectedIds);
    expect(result.summary).toMatchObject({ success: 4, failed: 0, uncertain: 0 });
    expect(result.results.map((row) => Boolean(row.replayed))).toEqual(ids.map((id) => completedIds.has(id)));
    expect(attempts[0]!.startedAt).toBe(catalogLatency);
    for (let index = 1; index < attempts.length; index += 1) {
      const previous = attempts[index - 1]!;
      const current = attempts[index]!;
      const expectedAt = previous.status === 429
        ? previous.respondedAt + Math.max(10_000, previous.retryAfterMs) + catalogLatency
        : previous.startedAt + 5_000 + catalogLatency;
      expect(current.startedAt).toBe(expectedAt);
      expect(current.startedAt - previous.startedAt).toBeGreaterThanOrEqual(5_000);
      if (previous.status === 429) {
        expect(current.id).toBe(previous.id);
        expect(current.startedAt - previous.respondedAt).toBeGreaterThanOrEqual(previous.retryAfterMs);
      }
    }
    for (const id of ids) {
      expect(productReads.get(id) ?? 0).toBe(completedIds.has(id) ? 0 : id === eligibleIds[0] ? 1 : 2);
      if (completedIds.has(id)) expect(store.values.get(ledgerKey(id))).toBe(originals.get(id));
    }

    const catalogReadsBeforeReplay = new Map(productReads);
    const replay = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(replay.summary).toMatchObject({ success: 4, failed: 0, uncertain: 0 });
    expect(replay.results.every((row) => row.replayed === true)).toBe(true);
    expect(purchaseAccounts).toEqual(expectedIds);
    expect(productReads).toEqual(catalogReadsBeforeReplay);
  });

  it("stops automatic retries on the fourth account's explicit ItemNotAvailable and retries only its own fresh product on a later click", async () => {
    const ids = [...accountIds, "game-account-0004"];
    const lastId = ids[3]!;
    const store = new MemoryClaimStore();
    const time = createPacingClock();
    const latestProducts = new Map<string, { google: string; offerId: string }>();
    const attempts: Array<{ id: string; sku: string; startedAt: number; respondedAt: number; status: number }> = [];
    const { fetchMock, purchaseAccounts, productReads } = createClaimFetch({
      ids, allAvailable: true,
      onProductRead: (id, readCount) => {
        time.advance(350);
        const product = {
          google: `own-sku-${id.slice(-4)}-revision-${readCount}`,
          offerId: id === ids[1] ? "" : `own-offer-${id.slice(-4)}-revision-${readCount}`,
        };
        latestProducts.set(id, product);
        return product;
      },
      onPurchase: (id, accountAttempt, body) => {
        const product = latestProducts.get(id)!;
        expect(body).toMatchObject({ gameAccountId: id, itemSku: product.google, offerId: product.offerId, quantity: 1 });
        const startedAt = time.clock();
        time.advance(950);
        const rateLimited = id === lastId && accountAttempt === 1;
        attempts.push({ id, sku: product.google, startedAt, respondedAt: time.clock(), status: rateLimited ? 429 : 200 });
        if (rateLimited) return new Response("mock rate limit", { status: 429, headers: { "Retry-After": "12" } });
        return id === lastId
          ? Response.json({ success: false, failreason: "ItemNotAvailable", orderAccessToken: null })
          : Response.json({ success: true, orderAccessToken: "free" });
      },
    });
    const dependencies = {
      store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z"),
      clock: time.clock, sleep: time.sleep,
    };

    const first = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(purchaseAccounts).toEqual([...ids, lastId]);
    expect(attempts.map(({ startedAt }) => startedAt)).toEqual([350, 5_700, 11_050, 16_400, 29_700]);
    expect(attempts[4]!.startedAt - attempts[3]!.respondedAt).toBe(12_350);
    expect(first.summary).toMatchObject({ success: 3, failed: 1, uncertain: 0 });
    expect(first.results[3]).toMatchObject({ status: "failed", reason: "STORE_ITEM_UNAVAILABLE" });
    expect(first.results[3]!.replayed).toBeUndefined();
    expect(productReads.get(lastId)).toBe(2);
    expect(JSON.parse(store.values.get(ledgerKey(lastId))!)).toMatchObject({
      version: 2, status: "failed", reason: "STORE_ITEM_UNAVAILABLE",
    });
    const successfulRecords = ids.slice(0, 3).map((id) => store.values.get(ledgerKey(id)));

    time.advance(14_000);
    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(purchaseAccounts).toEqual([...ids, lastId, lastId]);
    expect(second.summary).toMatchObject({ success: 3, failed: 1, uncertain: 0 });
    expect(second.results.slice(0, 3).every((row) => row.replayed === true)).toBe(true);
    expect(second.results[3]).toMatchObject({ status: "failed", reason: "STORE_ITEM_UNAVAILABLE" });
    expect(second.results[3]!.replayed).toBeUndefined();
    expect(productReads.get(lastId)).toBe(3);
    expect(attempts.filter(({ id }) => id === lastId).map(({ sku }) => sku)).toEqual([
      "own-sku-0004-revision-1", "own-sku-0004-revision-2", "own-sku-0004-revision-3",
    ]);
    for (const [index, id] of ids.slice(0, 3).entries()) {
      expect(productReads.get(id)).toBe(1);
      expect(store.values.get(ledgerKey(id))).toBe(successfulRecords[index]);
    }
  });

  it("caps a batch at four rate-limited attempts and preserves the cooldown for a later manual click", async () => {
    const store = new MemoryClaimStore();
    const locks = vi.spyOn(store, "setNx");
    const time = createPacingClock();
    const purchaseTimes: number[] = [];
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true, ids: [accountIds[0]!],
      onPurchase: (_id, attempt) => {
        purchaseTimes.push(time.clock());
        return attempt <= 4 ? new Response("limited", { status: 429 }) : Response.json({ orderAccessToken: "free" });
      },
    });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z"), clock: time.clock, sleep: time.sleep };

    const first = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(first.results[0]).toMatchObject({ status: "failed", reason: "STORE_RATE_LIMITED" });
    expect(purchaseAccounts).toHaveLength(4);
    expect(purchaseTimes).toEqual([0, 10_000, 30_000, 70_000]);
    expect(JSON.parse(store.values.get(ledgerKey(accountIds[0]!))!)).toMatchObject({ version: 2, status: "failed", reason: "STORE_RATE_LIMITED" });
    const paceKey = [...store.values.keys()].find((key) => key.includes(":pace:"));
    expect(store.values.get(paceKey!)).toBe("150000");
    expect(locks).toHaveBeenCalledWith(expect.stringContaining(":batch:"), expect.any(String), 330);

    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(second.results[0]).toMatchObject({ status: "success", reason: "FREE_PURCHASE_ACCEPTED" });
    expect(purchaseTimes).toEqual([0, 10_000, 30_000, 70_000, 150_000]);
    expect(purchaseAccounts).toHaveLength(5);
  });

  it.each([
    { price: 9.99, is_free: false }, { locked: 1 }, { disabled: 1 }, { google: "" }, { tags: [] },
  ])("does not retry a 429 when the refreshed product becomes unsafe: %j", async (changedProduct) => {
    const { fetchMock, purchaseAccounts, productReads } = createClaimFetch({
      allAvailable: true, ids: [accountIds[0]!],
      onPurchase: () => new Response("limited", { status: 429 }),
      onProductRead: (_id, count) => count > 1 ? changedProduct : {},
    });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store: new MemoryClaimStore(), fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z"),
    });

    expect(result.results[0]).toMatchObject({ status: "failed", reason: "STORE_ITEM_UNAVAILABLE" });
    expect(purchaseAccounts).toEqual([accountIds[0]]);
    expect(productReads.get(accountIds[0]!)).toBe(2);
  });

  it("preserves successful accounts and leaves later work unattempted when the batch time budget is exhausted", async () => {
    const store = new MemoryClaimStore();
    const time = createPacingClock();
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true, ids: accountIds.slice(0, 2),
      onPurchase: (id) => {
        if (id === accountIds[0]) time.advance(220_000);
        return Response.json({ orderAccessToken: "free" });
      },
    });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z"), clock: time.clock, sleep: time.sleep };

    const first = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(first.results[0]?.status).toBe("success");
    expect(first.results[1]).toMatchObject({ status: "failed", reason: "BATCH_TIME_BUDGET" });
    expect(purchaseAccounts).toEqual([accountIds[0]]);
    expect(store.values.has(ledgerKey(accountIds[1]!))).toBe(false);
    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    expect(second.summary.success).toBe(2);
    expect(second.results[0]?.replayed).toBe(true);
    expect(purchaseAccounts).toEqual(accountIds.slice(0, 2));
  });

  it("never shortens Retry-After when its cooldown exceeds the current execution budget", async () => {
    const store = new MemoryClaimStore();
    const time = createPacingClock();
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true, ids: [accountIds[0]!],
      onPurchase: (_id, attempt) => attempt === 1
        ? new Response("limited", { status: 429, headers: { "Retry-After": "300" } })
        : Response.json({ orderAccessToken: "free" }),
    });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z"), clock: time.clock, sleep: time.sleep };

    const first = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    const immediateRetry = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(first.results[0]).toMatchObject({ status: "failed", reason: "STORE_RATE_LIMITED" });
    expect(immediateRetry.results[0]).toMatchObject({ status: "failed", reason: "STORE_RATE_LIMITED" });
    expect(purchaseAccounts).toEqual([accountIds[0]]);
    expect(time.sleep).not.toHaveBeenCalled();
    time.advance(300_000);
    const afterCooldown = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    expect(afterCooldown.results[0]?.status).toBe("success");
    expect(purchaseAccounts).toEqual([accountIds[0], accountIds[0]]);
  });

  it("repairs only the two verified incident 429 records, preserving successes and original evidence", async () => {
    const fixture = createVerifiedIncidentFixture();
    const { fetchMock, purchaseAccounts, productReads } = createClaimFetch({ allAvailable: true, ids: fixture.ids });
    const dependencies = { store: fixture.store, fetchImplementation: fetchMock, now: new Date("2026-09-07T03:00:00Z") };

    const first = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(first.summary.success).toBe(4);
    expect(first.results.slice(0, 2).every((result) => result.status === "success" && result.replayed)).toBe(true);
    expect(purchaseAccounts).toEqual(fixture.ids.slice(2));
    for (const index of [0, 1]) {
      expect(fixture.store.values.get(fixture.ledgerKeys[index]!)).toBe(fixture.originals[index]);
      expect(productReads.has(fixture.ids[index]!)).toBe(false);
    }
    for (const index of [2, 3]) {
      const ledger = fixture.ledgerKeys[index]!;
      expect(JSON.parse(fixture.store.values.get(ledger)!)).toMatchObject({ version: 2, status: "success", reason: "FREE_PURCHASE_ACCEPTED" });
      expect(JSON.parse(fixture.store.values.get(ledger.replace(":ledger:", ":rate-repair:"))!)).toMatchObject({
        httpStatus: 429, previousRecord: fixture.originals[index],
      });
      expect(fixture.store.values.get(ledger.replace(":ledger:", ":recovery:"))).toBe(fixture.oldRecoveryMarker);
      expect(productReads.get(fixture.ids[index]!)).toBe(1);
    }

    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(second.results.every((result) => result.status === "success" && result.replayed)).toBe(true);
    expect(purchaseAccounts).toEqual(fixture.ids.slice(2));
    expect([...fixture.store.values.keys()].filter((key) => key.includes(":rate-repair:"))).toHaveLength(2);
    expect(JSON.stringify(first)).not.toContain("previousRecord");
  });

  it.each(["audit_mismatch", "record_outside_window", "different_batch", "wrong_subject"] as const)("never repairs version-two unknowns without matching incident evidence: %s", async (scenario) => {
    const fixture = createVerifiedIncidentFixture({
      ledgerTime: scenario === "record_outside_window" ? "2026-09-07T02:05:57.446Z" : undefined,
    });
    if (scenario === "audit_mismatch") fixture.audit.results[2]!.accountName = "Unmatched commander";
    if (scenario === "different_batch") fixture.audit.results[1]!.replayed = true;
    fixture.store.lists.set(fixture.auditKey, [JSON.stringify(fixture.audit)]);
    if (scenario === "wrong_subject") {
      fixture.store.lists.set("domi:claim:audit:another-subject", fixture.store.lists.get(fixture.auditKey)!);
      fixture.store.lists.delete(fixture.auditKey);
    }
    const { fetchMock, purchaseAccounts, productReads } = createClaimFetch({ allAvailable: true, ids: fixture.ids });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store: fixture.store, fetchImplementation: fetchMock, now: new Date("2026-09-07T03:00:00Z"),
    });

    expect(result.results.slice(2)).toEqual([0, 1].map(() => expect.objectContaining({
      status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED", replayed: true,
    })));
    expect(purchaseAccounts).toEqual([]);
    expect(productReads.size).toBe(0);
    fixture.ledgerKeys.forEach((key, index) => expect(fixture.store.values.get(key)).toBe(fixture.originals[index]));
    expect([...fixture.store.values.keys()].some((key) => key.includes(":rate-repair:"))).toBe(false);
  });

  it("never sends or changes the incident records when the repair backup cannot be written", async () => {
    const fixture = createVerifiedIncidentFixture();
    const originalSetNx = fixture.store.setNx.bind(fixture.store);
    vi.spyOn(fixture.store, "setNx").mockImplementation(async (key, value) => {
      if (key.includes(":rate-repair:")) throw new Error("repair backup unavailable");
      return originalSetNx(key, value);
    });
    const { fetchMock, purchaseAccounts } = createClaimFetch({ allAvailable: true, ids: fixture.ids });

    await expect(claimFreeLegendaryTokenForAllAccounts(session, {
      store: fixture.store, fetchImplementation: fetchMock, now: new Date("2026-09-07T03:00:00Z"),
    })).rejects.toThrow("repair backup unavailable");

    expect(purchaseAccounts).toEqual([]);
    fixture.ledgerKeys.forEach((key, index) => expect(fixture.store.values.get(key)).toBe(fixture.originals[index]));
    expect([...fixture.store.values.keys()].some((key) => key.includes(":rate-repair:") || key.includes(":account:"))).toBe(false);
  });

  it("does not repeat a verified repair when its backup marker exists but the old unknown ledger remains", async () => {
    const fixture = createVerifiedIncidentFixture();
    for (const index of [2, 3]) {
      fixture.store.values.set(fixture.ledgerKeys[index]!.replace(":ledger:", ":rate-repair:"), "existing-repair-marker");
    }
    const { fetchMock, purchaseAccounts } = createClaimFetch({ allAvailable: true, ids: fixture.ids });

    const result = await claimFreeLegendaryTokenForAllAccounts(session, {
      store: fixture.store, fetchImplementation: fetchMock, now: new Date("2026-09-07T03:00:00Z"),
    });

    expect(result.results.slice(2).every((item) => item.status === "uncertain" && item.replayed)).toBe(true);
    expect(purchaseAccounts).toEqual([]);
    fixture.ledgerKeys.forEach((key, index) => expect(fixture.store.values.get(key)).toBe(fixture.originals[index]));
  });

  it("retains confirmed rate-limit non-completion when the retry catalog lookup fails and permits a later manual retry", async () => {
    const store = new MemoryClaimStore();
    const { fetchMock, purchaseAccounts } = createClaimFetch({
      allAvailable: true, ids: [accountIds[0]!], failAccountOnePostCheck: true,
      onPurchase: (_id, attempt) => attempt === 1
        ? new Response("limited", { status: 429 })
        : Response.json({ orderAccessToken: "free" }),
    });
    const dependencies = { store, fetchImplementation: fetchMock, now: new Date("2026-08-28T00:00:00Z") };

    const first = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);

    expect(first.results[0]).toMatchObject({ status: "failed", reason: "UPSTREAM_BEFORE_PURCHASE" });
    expect(JSON.parse(store.values.get(ledgerKey(accountIds[0]!))!)).toMatchObject({ version: 2, status: "failed", reason: "UPSTREAM_BEFORE_PURCHASE" });
    expect(purchaseAccounts).toEqual([accountIds[0]]);
    const second = await claimFreeLegendaryTokenForAllAccounts(session, dependencies);
    expect(second.results[0]).toMatchObject({ status: "success", reason: "FREE_PURCHASE_ACCEPTED" });
    expect(purchaseAccounts).toEqual([accountIds[0], accountIds[0]]);
  });
});

// Exercise real pacing logic without any wall-clock waits in the unit suite.
function claimFreeLegendaryTokenForAllAccounts(appSession: AppSession, dependencies: ClaimServiceDependencies) {
  const time = createPacingClock(dependencies.now?.getTime() ?? Date.now());
  return runClaimService(appSession, { clock: time.clock, sleep: time.sleep, ...dependencies });
}

function createPacingClock(startMs = 0) {
  let currentMs = startMs;
  return {
    clock: () => currentMs,
    sleep: vi.fn(async (ms: number) => { currentMs += ms; }),
    advance: (ms: number) => { currentMs += ms; },
  };
}

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

function createVerifiedIncidentFixture({ ledgerTime = "2026-09-07T02:05:20.000Z" }: { ledgerTime?: string } = {}) {
  const store = new MemoryClaimStore();
  const ids = ["game-account-0000", ...accountIds];
  const ledgerKeys = ids.map((id) => ledgerKey(id).replace("2026-08-28", "2026-09-07"));
  const originals = ids.map((_, index) => JSON.stringify(index === 0
    ? { status: "success", reason: "CONFIRMED", recordedAt: "2026-09-07T02:00:00Z" }
    : { version: 2, status: index === 1 ? "success" : "uncertain", reason: index === 1 ? "FREE_PURCHASE_ACCEPTED" : "PURCHASE_RESPONSE_UNCONFIRMED", recovered: true, recordedAt: ledgerTime }));
  const oldRecoveryMarker = JSON.stringify({ version: 2, state: "in_flight", previousRecord: legacyUnknownRecord() });
  ledgerKeys.forEach((key, index) => {
    store.values.set(key, originals[index]!);
    if (index > 0) store.values.set(key.replace(":ledger:", ":recovery:"), oldRecoveryMarker);
  });
  const audit: ClaimAuditEntry = {
    version: 1, cycleId: "2026-09-07", executedAt: "2026-09-07T02:05:25.000Z",
    summary: { success: 2, already_claimed: 0, duplicate: 0, ineligible: 0, failed: 0, uncertain: 2 },
    results: ids.map((id, index) => ({
      accountName: `Commander ${index + 1}`, maskedAccountId: `••••${id.slice(-4)}`,
      status: index < 2 ? "success" : "uncertain",
      reason: index === 0 ? "CONFIRMED" : index === 1 ? "FREE_PURCHASE_ACCEPTED" : "PURCHASE_RESPONSE_UNCONFIRMED",
      ...(index === 0 ? { replayed: true as const } : { recovered: true as const }),
    })),
  };
  const subjectHash = createHash("sha256").update(session.admin.subject).digest("hex").slice(0, 24);
  const auditKey = `domi:claim:audit:${subjectHash}`;
  store.lists.set(auditKey, [JSON.stringify(audit)]);
  return { store, ids, ledgerKeys, originals, auditKey, audit, oldRecoveryMarker };
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
  onProductRead,
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
  onPurchase?: (id: string, attempt: number, body: {
    gameAccountId: string; itemSku?: string; offerId?: string; quantity?: number;
  }) => Response | Promise<Response>;
  onProductRead?: (id: string, readCount: number) => Record<string, unknown>;
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
      gameAccountId: string; itemSku?: string; offerId?: string; quantity?: number;
    };
    if (url.endsWith("/api/xsollastore/startpurchase")) {
      purchaseAccounts.push(body.gameAccountId);
      const response = onPurchase
        ? await onPurchase(body.gameAccountId, purchaseAccounts.filter((id) => id === body.gameAccountId).length, body)
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
      ...onProductRead?.(body.gameAccountId, readCount),
    };
    return Response.json(JSON.stringify([...additionalProducts, product]));
  });

  return { fetchMock, purchaseAccounts, productReads };
}
