import { describe, expect, it } from "vitest";

import { parseRetryAfterMs } from "./retry-after";

const nowMs = Date.UTC(2026, 8, 7, 2, 0, 0);

describe("parseRetryAfterMs", () => {
  it.each([
    ["0", 0],
    ["5", 5_000],
    [" 12 ", 12_000],
    ["0005", 5_000],
    ["9007199254740", 9_007_199_254_740_000],
    ["9007199254741", Number.MAX_SAFE_INTEGER],
    ["9".repeat(400), Number.MAX_SAFE_INTEGER],
  ])("parses delta seconds %s without unsafe numeric overflow", (header, expected) => {
    expect(parseRetryAfterMs(header, nowMs)).toBe(expected);
  });

  it("uses a future HTTP date relative to the supplied clock", () => {
    const header = new Date(nowMs + 12_000).toUTCString();
    expect(parseRetryAfterMs(header, nowMs)).toBe(12_000);
  });

  it.each(["Monday, 07-Sep-26 02:00:12 GMT", "Mon Sep  7 02:00:12 2026"])("accepts the obsolete HTTP-date format in UTC: %s", (header) => {
    expect(parseRetryAfterMs(header, nowMs)).toBe(12_000);
  });

  it("interprets obsolete dates more than fifty years ahead in the past", () => {
    expect(parseRetryAfterMs("Sunday, 06-Nov-94 08:49:37 GMT", nowMs)).toBe(0);
  });

  it.each([nowMs, nowMs - 30_000])("returns zero for an expired HTTP-date delay %i", (timestamp) => {
    expect(parseRetryAfterMs(new Date(timestamp).toUTCString(), nowMs)).toBe(0);
  });

  it.each([
    null, "", " ", "-1", "+1", "1.5", "1e2", "Infinity", "NaN",
    "0x10", "3 seconds", "5, 10", "2026-09-07T02:00:12Z", "private-header",
    "Mon, 31 Feb 2026 02:00:00 GMT", "Mon, 07 Sep 2026 99:00:00 GMT",
    "Monday, 31-Feb-26 02:00:00 GMT", "Mon Sep  7 99:00:00 2026",
  ])("ignores missing or invalid headers (%j)", (header) => {
    expect(parseRetryAfterMs(header, nowMs)).toBeUndefined();
  });
});
