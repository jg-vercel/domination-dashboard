import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError, type AuthDiagnostic } from "@/lib/auth/errors";
import { ClaimDiagnostics, logClaimDiagnostic } from "./diagnostics";

describe("purchase sequence diagnostics", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("distinguishes the first pending account from its directory position and tracks response-to-request gaps", () => {
    let now = 1_000;
    const diagnostics = new ClaimDiagnostics(() => now);
    now += 200;
    const first = diagnostics.beginAttempt(3, 1);
    now += 800;
    diagnostics.freeAcknowledged(first);
    now += 4_200;
    const second = diagnostics.beginAttempt(4, 1);
    now += 300;
    diagnostics.rejected(second, new AuthError("PURCHASE_RATE_LIMITED", {
      diagnostic: { stage: "free_purchase", status: 429, retryAfterMs: 12_000, reason: "http" },
    }));
    now += 12_000;
    const retry = diagnostics.beginAttempt(4, 2);
    now += 250;
    diagnostics.rejected(retry, new AuthError("PURCHASE_REJECTED", {
      diagnostic: { stage: "free_purchase", status: 200, purchaseFailure: "ItemNotAvailable", reason: "purchase_rejected" },
    }));

    const started = vi.mocked(console.info).mock.calls.filter(([event]) => event === "Free token attempt started").map(([, fields]) => fields);
    expect(started).toEqual([
      { accountIndex: 3, accountAttempt: 1, purchaseOrdinal: 1, firstPurchaseInBatch: true, batchElapsedMs: 200, sincePreviousAttemptMs: null, sincePreviousResponseMs: null },
      { accountIndex: 4, accountAttempt: 1, purchaseOrdinal: 2, firstPurchaseInBatch: false, batchElapsedMs: 5_200, sincePreviousAttemptMs: 5_000, sincePreviousResponseMs: 4_200 },
      { accountIndex: 4, accountAttempt: 2, purchaseOrdinal: 3, firstPurchaseInBatch: false, batchElapsedMs: 17_500, sincePreviousAttemptMs: 12_300, sincePreviousResponseMs: 12_000 },
    ]);
    const completed = vi.mocked(console.info).mock.calls.filter(([event]) => event === "Free token attempt completed").map(([, fields]) => fields);
    expect(completed).toEqual([
      { accountIndex: 3, accountAttempt: 1, purchaseOrdinal: 1, firstPurchaseInBatch: true, batchElapsedMs: 1_000, requestDurationMs: 800, outcome: "free_acknowledged" },
      { accountIndex: 4, accountAttempt: 1, purchaseOrdinal: 2, firstPurchaseInBatch: false, batchElapsedMs: 5_500, requestDurationMs: 300, outcome: "rate_limited", httpStatus: 429, purchaseFailure: null, retryAfterMs: 12_000 },
      { accountIndex: 4, accountAttempt: 2, purchaseOrdinal: 3, firstPurchaseInBatch: false, batchElapsedMs: 17_750, requestDurationMs: 250, outcome: "rejected", httpStatus: 200, purchaseFailure: "ItemNotAvailable", retryAfterMs: null },
    ]);
  });

  it("starts a new batch with no claim of knowing the previous batch's timing", () => {
    new ClaimDiagnostics(() => 10).beginAttempt(2, 1);
    new ClaimDiagnostics(() => 20).beginAttempt(4, 1);
    expect(console.info).toHaveBeenLastCalledWith("Free token attempt started", expect.objectContaining({
      accountIndex: 4, purchaseOrdinal: 1, firstPurchaseInBatch: true,
      sincePreviousAttemptMs: null, sincePreviousResponseMs: null,
    }));
  });

  it.each([
    [new AuthError("PAID_CHECKOUT_REJECTED"), "paid_checkout"],
    [new AuthError("SESSION_EXPIRED"), "unconfirmed"],
    [new AuthError("UPSTREAM_UNAVAILABLE"), "unconfirmed"],
    [new Error("secret response with token and account ID"), "unconfirmed"],
    [{ token: "private-token", response: "private-response" }, "unconfirmed"],
  ])("logs only a fixed outcome for an error, never its raw contents", (error, outcome) => {
    const diagnostics = new ClaimDiagnostics(() => 0);
    diagnostics.rejected(diagnostics.beginAttempt(1, 1), error);
    expect(console.info).toHaveBeenLastCalledWith("Free token attempt completed", expect.objectContaining({ outcome }));
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/secret|private|account ID/);
  });

  it("allowlists diagnostic values even if an error carries unexpected fields", () => {
    const diagnostics = new ClaimDiagnostics(() => 0);
    const error = new AuthError("PURCHASE_REJECTED", {
      diagnostic: {
        stage: "free_purchase", status: "private-status", purchaseFailure: "private-reason",
        retryAfterMs: "private-header", token: "private-token", accountId: "private-id",
      } as unknown as AuthDiagnostic,
      cause: new Error("private-cause"),
    });
    diagnostics.rejected(diagnostics.beginAttempt(1, 1), error);
    expect(console.info).toHaveBeenLastCalledWith("Free token attempt completed", expect.objectContaining({
      outcome: "rejected", httpStatus: null, purchaseFailure: null, retryAfterMs: null,
    }));
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("private");
  });

  it.each([-1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])("does not serialize an invalid delay: %s", (retryAfterMs) => {
    const diagnostics = new ClaimDiagnostics(() => 0);
    diagnostics.rejected(diagnostics.beginAttempt(1, 1), new AuthError("PURCHASE_RATE_LIMITED", {
      diagnostic: { stage: "free_purchase", status: 429, retryAfterMs },
    }));
    expect(console.info).toHaveBeenLastCalledWith("Free token attempt completed", expect.objectContaining({ retryAfterMs: null }));
  });

  it("cannot interrupt processing when console logging throws", () => {
    vi.mocked(console.info).mockImplementation(() => { throw new Error("logger offline"); });
    const diagnostics = new ClaimDiagnostics(() => 0);
    expect(() => {
      const attempt = diagnostics.beginAttempt(3, 1);
      diagnostics.freeAcknowledged(attempt);
      diagnostics.rejected(diagnostics.beginAttempt(4, 1), new Error("network error"));
      logClaimDiagnostic("Free token catalog check", { accountIndex: 4 });
    }).not.toThrow();
  });
});
