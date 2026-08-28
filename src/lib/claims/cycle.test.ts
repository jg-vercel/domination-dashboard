import { describe, expect, it } from "vitest";

import { getClaimCycle } from "./cycle";

describe("KST 09:00 claim cycle", () => {
  it("keeps 08:59:59 KST in the previous cycle", () => {
    expect(getClaimCycle(new Date("2026-08-27T23:59:59.000Z"))).toMatchObject({
      id: "2026-08-27",
      startsAt: "2026-08-27T00:00:00.000Z",
      endsAt: "2026-08-28T00:00:00.000Z",
    });
  });

  it("starts a new cycle exactly at 09:00:00 KST", () => {
    expect(getClaimCycle(new Date("2026-08-28T00:00:00.000Z"))).toEqual({
      id: "2026-08-28",
      startsAt: "2026-08-28T00:00:00.000Z",
      endsAt: "2026-08-29T00:00:00.000Z",
      ledgerTtlSeconds: 172_800,
    });
  });

  it("rejects an invalid clock value", () => {
    expect(() => getClaimCycle(new Date("invalid"))).toThrowError(RangeError);
  });
});
