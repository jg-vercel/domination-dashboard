import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { DomiNationsAccount } from "@/lib/dominations/client";
import { RedisStoreError, type ClaimStore } from "@/lib/idempotency/redis-rest";

import type { ClaimAuditEntry } from "./audit";
import {
  findVerifiedRateLimitRepairs,
  isVerifiedIncidentRecord,
  VERIFIED_RATE_LIMIT_INCIDENT,
} from "./verified-rate-limit-repair";

const SUBJECT = "authenticated-admin-subject";
const CYCLE_ID = "2026-09-07";
const INCIDENT_TIME = "2026-09-07T02:05:10.000Z";

function auditKey(subject: string): string {
  return `domi:claim:audit:${createHash("sha256").update(subject, "utf8").digest("hex").slice(0, 24)}`;
}

function fixtureAccounts(): DomiNationsAccount[] {
  return [1, 2, 3, 4].map((number) => ({
    gameAccountId: `private-game-account-000${number}`,
    name: `Commander ${number}`,
    age: null,
    trophies: null,
    clientVersion: null,
  }));
}

function fixtureAudit(): ClaimAuditEntry {
  return {
    version: 1,
    cycleId: CYCLE_ID,
    executedAt: INCIDENT_TIME,
    summary: { success: 2, already_claimed: 0, duplicate: 0, ineligible: 0, failed: 0, uncertain: 2 },
    results: [
      { accountName: "Commander 1", maskedAccountId: "••••0001", status: "success", reason: "CONFIRMED", replayed: true },
      { accountName: "Commander 2", maskedAccountId: "••••0002", status: "success", reason: "FREE_PURCHASE_ACCEPTED", recovered: true },
      { accountName: "Commander 3", maskedAccountId: "••••0003", status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED", recovered: true },
      { accountName: "Commander 4", maskedAccountId: "••••0004", status: "uncertain", reason: "PURCHASE_RESPONSE_UNCONFIRMED", recovered: true },
    ],
  };
}

function fixtureRecord(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 2,
    status: "uncertain",
    reason: "PURCHASE_RESPONSE_UNCONFIRMED",
    recovered: true,
    recordedAt: INCIDENT_TIME,
    ...overrides,
  });
}

function createAuditStore(entries: unknown[] = [fixtureAudit()]) {
  const lists = new Map<string, string[]>();
  const seed = (subject: string, values: unknown[]) => {
    lists.set(auditKey(subject), values.map((value) => typeof value === "string" ? value : JSON.stringify(value)));
  };
  seed(SUBJECT, entries);
  const store = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    setNx: vi.fn(async () => false),
    compareDelete: vi.fn(async () => false),
    appendList: vi.fn(async () => undefined),
    listRange: vi.fn(async (key: string, start: number, stop: number) =>
      (lists.get(key) ?? []).slice(start, stop + 1)),
  } satisfies ClaimStore;
  return { store, seed };
}

describe("verified rate-limit incident account matching", () => {
  it("matches the full incident and returns only the last two account IDs without writing", async () => {
    const { store } = createAuditStore();
    const accounts = fixtureAccounts();

    const result = await findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, accounts, store);

    expect(result).toEqual(new Set([accounts[2]!.gameAccountId, accounts[3]!.gameAccountId]));
    expect(store.listRange).toHaveBeenCalledExactlyOnceWith(auditKey(SUBJECT), 0, 49);
    expect(store.listRange.mock.calls[0]![0]).not.toContain(SUBJECT);
    expect(store.get).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
    expect(store.setNx).not.toHaveBeenCalled();
    expect(store.compareDelete).not.toHaveBeenCalled();
    expect(store.appendList).not.toHaveBeenCalled();
  });

  it("never reads another administrator's matching audit list", async () => {
    const { store, seed } = createAuditStore([]);
    seed("different-google-subject", [fixtureAudit()]);

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, fixtureAccounts(), store))
      .resolves.toEqual(new Set());

    expect(store.listRange).toHaveBeenCalledExactlyOnceWith(auditKey(SUBJECT), 0, 49);
  });

  it.each(["2026-09-06", "2026-09-08", "invalid-cycle"])(
    "does not even read audits for a different cycle %s",
    async (cycle) => {
      const { store } = createAuditStore();

      await expect(findVerifiedRateLimitRepairs(SUBJECT, cycle, fixtureAccounts(), store))
        .resolves.toEqual(new Set());

      expect(store.listRange).not.toHaveBeenCalled();
    },
  );

  it("does not scan beyond the authenticated subject's newest fifty audits", async () => {
    const otherAudit = { ...fixtureAudit(), executedAt: "2026-09-07T03:00:00.000Z" };
    const { store } = createAuditStore([...Array.from({ length: 50 }, () => otherAudit), fixtureAudit()]);

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, fixtureAccounts(), store))
      .resolves.toEqual(new Set());

    expect(store.listRange).toHaveBeenCalledExactlyOnceWith(auditKey(SUBJECT), 0, 49);
  });

  it("rejects two matching incident audits instead of choosing either one", async () => {
    const { store } = createAuditStore([fixtureAudit(), { ...fixtureAudit(), executedAt: "2026-09-07T02:05:20.000Z" }]);

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, fixtureAccounts(), store))
      .resolves.toEqual(new Set());
  });

  it("rejects even identical duplicated matching audits as ambiguous", async () => {
    const entry = fixtureAudit();
    const { store } = createAuditStore([entry, entry]);

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, fixtureAccounts(), store))
      .resolves.toEqual(new Set());
  });

  it.each([
    ["2026-09-07T02:04:57.444Z", false],
    ["2026-09-07T02:04:57.445Z", true],
    ["2026-09-07T02:05:57.445Z", true],
    ["2026-09-07T02:05:57.446Z", false],
    ["invalid-time", false],
  ])("applies the exact inclusive audit time window to %s", async (executedAt, eligible) => {
    const { store } = createAuditStore([{ ...fixtureAudit(), executedAt }]);

    const result = await findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, fixtureAccounts(), store);

    expect(result.size).toBe(eligible ? 2 : 0);
  });

  it.each([
    { label: "wrong cycle", patch: { cycleId: "2026-09-06" } },
    { label: "unknown audit version", patch: { version: 2 } },
    { label: "missing audit version", patch: { version: undefined } },
    { label: "wrong audit version type", patch: { version: "1" } },
    { label: "invalid summary", patch: { summary: {} } },
    { label: "missing result list", patch: { results: undefined } },
  ])("rejects an audit with $label", async ({ patch }) => {
    const { store } = createAuditStore([{ ...fixtureAudit(), ...patch }]);

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, fixtureAccounts(), store))
      .resolves.toEqual(new Set());
  });

  it.each(["not-json", "null", "[]", "{}", "42"])("ignores invalid stored audit %j", async (entry) => {
    const { store } = createAuditStore([entry]);

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, fixtureAccounts(), store))
      .resolves.toEqual(new Set());
  });

  it.each([0, 1, 2, 3, 5])("requires exactly four audit results, not %i", async (count) => {
    const entry = fixtureAudit();
    entry.results = count === 5 ? [...entry.results, entry.results[3]!] : entry.results.slice(0, count);
    const { store } = createAuditStore([entry]);

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, fixtureAccounts(), store))
      .resolves.toEqual(new Set());
  });

  it.each([
    { index: 0, patch: { status: "already_claimed" } },
    { index: 0, patch: { reason: "FREE_PURCHASE_ACCEPTED" } },
    { index: 0, patch: { replayed: undefined } },
    { index: 1, patch: { status: "uncertain" } },
    { index: 1, patch: { reason: "CONFIRMED" } },
    { index: 1, patch: { recovered: undefined } },
    { index: 1, patch: { replayed: true } },
    { index: 2, patch: { status: "success" } },
    { index: 2, patch: { reason: "POST_PURCHASE_UNCONFIRMED" } },
    { index: 2, patch: { recovered: undefined } },
    { index: 2, patch: { replayed: true } },
    { index: 3, patch: { status: "failed" } },
    { index: 3, patch: { reason: "PREVIOUS_OUTCOME_UNKNOWN" } },
    { index: 3, patch: { recovered: undefined } },
    { index: 3, patch: { replayed: true } },
    { index: 3, patch: { status: "made-up-status" } },
    { index: 3, patch: { reason: "private upstream response" } },
  ])("rejects any changed incident result: $index $patch", async ({ index, patch }) => {
    const entry = fixtureAudit();
    Object.assign(entry.results[index]!, patch);
    const { store } = createAuditStore([entry]);

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, fixtureAccounts(), store))
      .resolves.toEqual(new Set());
  });

  it.each(["true", "false", 1, 0, null, {}, []])(
    "does not treat a malformed replayed flag %j as proof of a non-replayed request",
    async (replayed) => {
      const entry = fixtureAudit();
      Object.assign(entry.results[2]!, { replayed });
      const { store } = createAuditStore([entry]);

      await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, fixtureAccounts(), store))
        .resolves.toEqual(new Set());
    },
  );

  it.each([0, 1, 2, 3])("requires account %i to still resolve uniquely, including successful accounts", async (index) => {
    const accounts = fixtureAccounts();
    accounts[index]!.name = "A different current account name";
    const { store } = createAuditStore();

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, accounts, store))
      .resolves.toEqual(new Set());
  });

  it("rejects one missing account rather than repairing a partial match", async () => {
    const { store } = createAuditStore();

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, fixtureAccounts().slice(1), store))
      .resolves.toEqual(new Set());
  });

  it("rejects a changed suffix even when the account name still matches", async () => {
    const accounts = fixtureAccounts();
    accounts[2]!.gameAccountId = "another-account-9999";
    const { store } = createAuditStore();

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, accounts, store))
      .resolves.toEqual(new Set());
  });

  it("rejects two current accounts with both the same name and the same masked suffix", async () => {
    const accounts = fixtureAccounts();
    accounts.push({ ...accounts[2]!, gameAccountId: "another-private-account-0003" });
    const { store } = createAuditStore();

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, accounts, store))
      .resolves.toEqual(new Set());
  });

  it("allows a shared masked suffix when distinct names uniquely resolve each account", async () => {
    const accounts = fixtureAccounts();
    accounts[3]!.gameAccountId = "another-private-account-0003";
    const entry = fixtureAudit();
    entry.results[3]!.maskedAccountId = "••••0003";
    const { store } = createAuditStore([entry]);

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, accounts, store))
      .resolves.toEqual(new Set([accounts[2]!.gameAccountId, accounts[3]!.gameAccountId]));
  });

  it("rejects incident rows that resolve twice to the same actual account", async () => {
    const entry = fixtureAudit();
    entry.results[3]!.accountName = entry.results[2]!.accountName;
    entry.results[3]!.maskedAccountId = entry.results[2]!.maskedAccountId;
    const { store } = createAuditStore([entry]);

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, fixtureAccounts(), store))
      .resolves.toEqual(new Set());
  });

  it("resolves accounts by the exact name and suffix rather than current directory order", async () => {
    const accounts = fixtureAccounts();
    const { store } = createAuditStore();

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, [...accounts].reverse(), store))
      .resolves.toEqual(new Set([accounts[2]!.gameAccountId, accounts[3]!.gameAccountId]));
  });

  it("fails closed on an audit store error without repairing or writing anything", async () => {
    const { store } = createAuditStore();
    const unavailable = new RedisStoreError();
    store.listRange.mockRejectedValueOnce(unavailable);

    await expect(findVerifiedRateLimitRepairs(SUBJECT, CYCLE_ID, fixtureAccounts(), store))
      .rejects.toBe(unavailable);

    expect(store.set).not.toHaveBeenCalled();
    expect(store.setNx).not.toHaveBeenCalled();
  });
});

describe("verified rate-limit incident ledger predicate", () => {
  it("recognizes only the known versioned recovered uncertain outcome", () => {
    expect(isVerifiedIncidentRecord(fixtureRecord())).toBe(true);
    expect(VERIFIED_RATE_LIMIT_INCIDENT.endsAt - VERIFIED_RATE_LIMIT_INCIDENT.startsAt).toBe(60_000);
  });

  it.each([
    ["2026-09-07T02:04:57.444Z", false],
    ["2026-09-07T02:04:57.445Z", true],
    ["2026-09-07T02:05:57.445Z", true],
    ["2026-09-07T02:05:57.446Z", false],
    ["2026-09-06T02:05:10.000Z", false],
    ["2026-09-08T02:05:10.000Z", false],
    ["invalid-time", false],
  ])("applies the exact inclusive ledger recordedAt window to %s", (recordedAt, eligible) => {
    expect(isVerifiedIncidentRecord(fixtureRecord({ recordedAt }))).toBe(eligible);
  });

  it.each([
    { version: undefined }, { version: 1 }, { version: 3 }, { version: "2" }, { version: null },
    { status: "success", reason: "FREE_PURCHASE_ACCEPTED" },
    { status: "success", reason: "CONFIRMED" },
    { status: "already_claimed", reason: "ALREADY_CLAIMED" },
    { status: "failed", reason: "STORE_RATE_LIMITED" },
    { status: "ineligible", reason: "PAID_TOKEN_REJECTED" },
    { status: "ineligible", reason: "STORE_PURCHASE_LIMIT" },
    { status: undefined }, { reason: "POST_PURCHASE_UNCONFIRMED" },
    { reason: "PREVIOUS_OUTCOME_UNKNOWN" }, { reason: undefined },
    { recovered: undefined }, { recovered: false }, { recovered: "true" }, { recovered: 1 },
    { recordedAt: undefined }, { recordedAt: null }, { recordedAt: VERIFIED_RATE_LIMIT_INCIDENT.startsAt },
  ])("rejects a non-incident ledger record %j", (overrides) => {
    expect(isVerifiedIncidentRecord(fixtureRecord(overrides))).toBe(false);
  });

  it.each(["", "not-json", "null", "[]", "{}", "42", '"a string"'])(
    "rejects a malformed or non-object ledger %j",
    (value) => { expect(isVerifiedIncidentRecord(value)).toBe(false); },
  );
});
