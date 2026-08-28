import { describe, expect, it, vi } from "vitest";

import type { ClaimStore } from "@/lib/idempotency/redis-rest";

import {
  CLAIM_AUDIT_MAX_ITEMS,
  CLAIM_AUDIT_TTL_SECONDS,
  listClaimAudits,
  parseAuditEntry,
  recordClaimAudit,
} from "./audit";

const summary = {
  success: 1,
  already_claimed: 0,
  duplicate: 0,
  ineligible: 0,
  failed: 0,
  uncertain: 0,
};

const safeResult = {
  accountName: "Commander",
  maskedAccountId: "••••0001",
  status: "success" as const,
  reason: "CONFIRMED" as const,
};

describe("claim audit", () => {
  it("stores only safe batch output with bounded retention", async () => {
    const store = createAuditStore();

    await recordClaimAudit(
      "private-google-subject",
      {
        id: "2026-08-28",
        startsAt: "2026-08-28T00:00:00.000Z",
        endsAt: "2026-08-29T00:00:00.000Z",
        ledgerTtlSeconds: 172_800,
      },
      [safeResult],
      summary,
      store,
      new Date("2026-08-28T00:01:00.000Z"),
    );

    expect(store.appendList).toHaveBeenCalledOnce();
    const [key, value, maxItems, ttl] = vi.mocked(store.appendList).mock.calls[0]!;
    expect(key).not.toContain("private-google-subject");
    expect(maxItems).toBe(CLAIM_AUDIT_MAX_ITEMS);
    expect(ttl).toBe(CLAIM_AUDIT_TTL_SECONDS);
    expect(JSON.parse(value)).toEqual({
      version: 1,
      cycleId: "2026-08-28",
      executedAt: "2026-08-28T00:01:00.000Z",
      summary,
      results: [safeResult],
    });
  });

  it("drops corrupted or non-allowlisted stored entries", async () => {
    const valid = JSON.stringify({
      version: 1,
      cycleId: "2026-08-28",
      executedAt: "2026-08-28T00:01:00.000Z",
      summary,
      results: [safeResult],
    });
    const store = createAuditStore([
      valid,
      "not-json",
      JSON.stringify({
        version: 1,
        cycleId: "2026-08-28",
        executedAt: "2026-08-28T00:01:00.000Z",
        summary,
        results: [{ ...safeResult, maskedAccountId: "full-account-id" }],
      }),
    ]);

    await expect(listClaimAudits("subject", store)).resolves.toEqual([
      JSON.parse(valid),
    ]);
    expect(parseAuditEntry("not-json")).toBeNull();
  });
});

function createAuditStore(values: string[] = []): ClaimStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    setNx: vi.fn(),
    compareDelete: vi.fn(),
    appendList: vi.fn().mockResolvedValue(undefined),
    listRange: vi.fn().mockResolvedValue(values),
  };
}
