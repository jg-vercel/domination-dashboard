import { describe, expect, it, vi } from "vitest";

import { RedisStoreError, type ClaimStore } from "@/lib/idempotency/redis-rest";

import {
  BATCH_LOCK_TTL_SECONDS,
  CLAIM_EXECUTION_BUDGET_MS,
  ClaimPacer,
  ClaimPacingDeferredError,
  PURCHASE_INTERVAL_MS,
} from "./pacing";

const GATE_KEY = "test:claim:pace:opaque-subject";
const START_TIME = 1_788_739_200_000;

class MemoryClaimStore implements ClaimStore {
  readonly values = new Map<string, string>();
  readonly expirations = new Map<string, number>();

  constructor(private readonly clock: () => number) {}

  get = vi.fn(async (key: string) => {
    if ((this.expirations.get(key) ?? Infinity) <= this.clock()) {
      this.values.delete(key);
      this.expirations.delete(key);
    }
    return this.values.get(key) ?? null;
  });

  set = vi.fn(async (key: string, value: string, ttlSeconds: number) => {
    this.values.set(key, value);
    this.expirations.set(key, this.clock() + ttlSeconds * 1_000);
  });

  setNx = vi.fn(async (key: string, value: string, ttlSeconds: number) => {
    if (await this.get(key) !== null) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  });

  compareDelete = vi.fn(async (key: string, owner: string) => {
    if (await this.get(key) !== owner) return false;
    this.values.delete(key);
    this.expirations.delete(key);
    return true;
  });

  appendList = vi.fn(async () => undefined);
  listRange = vi.fn(async () => [] as string[]);
}

function createHarness() {
  let currentTime = START_TIME;
  const clock = () => currentTime;
  const advance = (ms: number) => { currentTime += ms; };
  const sleep = vi.fn(async (ms: number) => { advance(ms); });
  const store = new MemoryClaimStore(clock);
  const pacer = new ClaimPacer(store, GATE_KEY, clock, sleep);
  return { clock, advance, sleep, store, pacer };
}

describe("purchase pacing", () => {
  it("allows the first attempt immediately when there is no stored cooldown", async () => {
    const { pacer, sleep, store, clock } = createHarness();

    await pacer.waitForTurn();

    expect(clock()).toBe(START_TIME);
    expect(sleep).not.toHaveBeenCalled();
    expect(store.get).toHaveBeenCalledWith(GATE_KEY);
    expect(store.set).not.toHaveBeenCalled();
  });

  it("persists the first attempt before enforcing at least five seconds for the next one", async () => {
    const { pacer, sleep, store, clock, advance } = createHarness();

    await pacer.waitForTurn();
    await pacer.recordAttempt();
    advance(1_200);
    await pacer.waitForTurn();

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([3_800]);
    expect(clock() - START_TIME).toBe(PURCHASE_INTERVAL_MS);
    expect(store.set).toHaveBeenCalledWith(
      GATE_KEY,
      String(START_TIME + PURCHASE_INTERVAL_MS),
      BATCH_LOCK_TTL_SECONDS + PURCHASE_INTERVAL_MS / 1_000,
    );
  });

  it("includes gate write latency in the in-batch request spacing", async () => {
    const { pacer, store, clock, advance, sleep } = createHarness();
    store.set.mockImplementationOnce(async (key, value) => {
      store.values.set(key, value);
      advance(700);
    });

    await pacer.recordAttempt();
    const previousRequestStart = clock();
    await pacer.waitForTurn();

    expect(clock() - previousRequestStart).toBe(PURCHASE_INTERVAL_MS);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([PURCHASE_INTERVAL_MS]);
  });

  it("does not sleep again once the persisted cooldown has elapsed", async () => {
    const { pacer, advance, sleep } = createHarness();
    await pacer.recordAttempt();
    advance(PURCHASE_INTERVAL_MS + 1);

    await pacer.waitForTurn();

    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([0, 1, 4_999, 5_000, 15_000, 125_321])(
    "respects a requested cooldown of %i ms without shortening it",
    async (delayMs) => {
      const { pacer, clock, sleep } = createHarness();

      await pacer.defer(delayMs);
      await pacer.waitForTurn();

      expect(clock() - START_TIME).toBe(Math.max(delayMs, PURCHASE_INTERVAL_MS));
      expect(sleep.mock.calls.reduce((total, [ms]) => total + ms, 0))
        .toBeGreaterThanOrEqual(delayMs);
    },
  );

  it("never shortens an earlier longer Retry-After when a shorter delay is recorded", async () => {
    const { pacer, clock, advance, store } = createHarness();

    await pacer.defer(60_000);
    advance(1_000);
    await pacer.defer(10_000);
    await pacer.waitForTurn();

    expect(clock()).toBe(START_TIME + 60_000);
    expect(store.values.get(GATE_KEY)).toBe(String(START_TIME + 60_000));
  });

  it("chunks long waits into at most fifty seconds and preserves the full interval", async () => {
    const { pacer, sleep, clock } = createHarness();

    await pacer.defer(125_321);
    await pacer.waitForTurn();

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([50_000, 50_000, 25_321]);
    expect(clock() - START_TIME).toBe(125_321);
  });

  it("rechecks the clock after an early sleep wakeup instead of starting too soon", async () => {
    const { pacer, sleep, clock, advance } = createHarness();
    sleep.mockImplementationOnce(async () => { advance(4_000); });

    await pacer.defer(5_000);
    await pacer.waitForTurn();

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5_000, 1_000]);
    expect(clock() - START_TIME).toBe(5_000);
  });

  it("preserves a cooldown across a new batch using the same Redis gate", async () => {
    const { pacer, store, sleep, clock, advance } = createHarness();
    await pacer.recordAttempt();
    advance(1_500);
    const nextBatch = new ClaimPacer(store, GATE_KEY, clock, sleep);

    await nextBatch.waitForTurn();

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([3_500]);
    expect(clock()).toBe(START_TIME + PURCHASE_INTERVAL_MS);
  });

  it("preserves a Retry-After beyond the old batch budget for a later batch", async () => {
    const { pacer, store, sleep, clock, advance } = createHarness();
    await pacer.defer(300_000);
    await expect(pacer.waitForTurn()).rejects.toMatchObject({ reason: "STORE_RATE_LIMITED" });
    expect(sleep).not.toHaveBeenCalled();
    advance(100_000);
    const nextBatch = new ClaimPacer(store, GATE_KEY, clock, sleep);

    await nextBatch.waitForTurn();

    expect(clock()).toBe(START_TIME + 300_000);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([50_000, 50_000, 50_000, 50_000]);
  });

  it.each([216_000, 240_000, 10 ** 12, Number.MAX_SAFE_INTEGER])(
    "defers a %i ms cooldown outside the budget without sleeping or truncating it",
    async (delayMs) => {
      const { pacer, store, sleep } = createHarness();

      await pacer.defer(delayMs);
      await expect(pacer.waitForTurn()).rejects.toMatchObject({
        name: "ClaimPacingDeferredError", reason: "STORE_RATE_LIMITED",
      });

      expect(sleep).not.toHaveBeenCalled();
      expect(Number(store.values.get(GATE_KEY)))
        .toBe(Math.min(Number.MAX_SAFE_INTEGER, START_TIME + delayMs));
      expect(Number.isSafeInteger(Number(store.values.get(GATE_KEY)))).toBe(true);
    },
  );

  it("stores an enormous cooldown with a valid Redis TTL", async () => {
    const { pacer, store } = createHarness();

    await pacer.defer(Number.MAX_SAFE_INTEGER);

    expect(store.set).toHaveBeenCalledWith(GATE_KEY, String(Number.MAX_SAFE_INTEGER), 2_147_483_647);
  });

  it.each(["waitForTurn", "recordAttempt"] as const)(
    "fails closed before %s when the execution budget is exhausted",
    async (operation) => {
      const { pacer, store, sleep, advance } = createHarness();
      advance(CLAIM_EXECUTION_BUDGET_MS);

      await expect(pacer[operation]()).rejects.toMatchObject({ reason: "BATCH_TIME_BUDGET" });

      expect(store.get).not.toHaveBeenCalled();
      expect(store.set).not.toHaveBeenCalled();
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it("does not allow a request when a sleep overshoots the execution budget", async () => {
    const { pacer, sleep, advance } = createHarness();
    sleep.mockImplementationOnce(async () => { advance(CLAIM_EXECUTION_BUDGET_MS); });
    await pacer.defer(5_000);

    await expect(pacer.waitForTurn()).rejects.toMatchObject({ reason: "BATCH_TIME_BUDGET" });

    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("keeps the lock lease longer than the 300-second function and the internal budget", () => {
    expect(BATCH_LOCK_TTL_SECONDS).toBe(330);
    expect(BATCH_LOCK_TTL_SECONDS).toBeGreaterThan(300);
    expect(CLAIM_EXECUTION_BUDGET_MS).toBeLessThan(300_000);
    expect(CLAIM_EXECUTION_BUDGET_MS).toBeLessThan(BATCH_LOCK_TTL_SECONDS * 1_000);
  });

  it("fails closed on a Redis read failure without waiting or updating the gate", async () => {
    const { pacer, store, sleep } = createHarness();
    const unavailable = new RedisStoreError();
    store.get.mockRejectedValueOnce(unavailable);

    await expect(pacer.waitForTurn()).rejects.toBe(unavailable);

    expect(sleep).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it.each(["recordAttempt", "defer"] as const)(
    "fails closed on a Redis write failure during %s",
    async (operation) => {
      const { pacer, store, sleep } = createHarness();
      const unavailable = new RedisStoreError();
      store.set.mockRejectedValueOnce(unavailable);

      const result = operation === "defer" ? pacer.defer(60_000) : pacer.recordAttempt();
      await expect(result).rejects.toBe(unavailable);

      expect(sleep).not.toHaveBeenCalled();
      expect(store.values.has(GATE_KEY)).toBe(false);
    },
  );

  it.each([
    "", " ", "\n", "junk", "-1", "1.5", "NaN", "Infinity", "9007199254740992",
    "0x10", "1e3", "+1", "1.0", "01", " 1", "1 ", "{}", "[]", "null",
  ])("rejects a malformed persisted gate %j instead of allowing a request", async (value) => {
    const { pacer, store, sleep } = createHarness();
    store.values.set(GATE_KEY, value);

    await expect(pacer.waitForTurn()).rejects.toBeInstanceOf(RedisStoreError);

    expect(sleep).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
    expect(store.values.get(GATE_KEY)).toBe(value);
  });

  it.each(["0", "1", String(START_TIME - 1), String(START_TIME)])(
    "accepts a valid elapsed persisted gate %j",
    async (value) => {
      const { pacer, store, sleep } = createHarness();
      store.values.set(GATE_KEY, value);

      await pacer.waitForTurn();

      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it("does not confuse a valid distant gate with a malformed value", async () => {
    const { pacer, store, sleep } = createHarness();
    store.values.set(GATE_KEY, String(Number.MAX_SAFE_INTEGER));

    await expect(pacer.waitForTurn()).rejects.toBeInstanceOf(ClaimPacingDeferredError);

    expect(sleep).not.toHaveBeenCalled();
  });
});
