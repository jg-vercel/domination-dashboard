import { describe, expect, it, vi } from "vitest";

import type { DomiNationsCredential } from "@/lib/auth/session";

import { loadAccountDirectory, loadDashboardSnapshot } from "./snapshot";

const credentials: DomiNationsCredential = {
  accessToken: "dominations-bearer",
  cookies: ["domi=session"],
  userId: "user-1",
  xsollaId: "xsolla-1",
};

const accountIds = [
  "game-account-0001",
  "game-account-0002",
  "game-account-0003",
];

describe("dashboard snapshot", () => {
  it("requires exactly three unique accounts in both account sources", async () => {
    const fetchMock = createDashboardFetch({ listedIds: accountIds.slice(0, 2) });

    await expect(
      loadAccountDirectory(credentials, fetchMock),
    ).rejects.toMatchObject({ code: "ACCOUNT_COUNT_MISMATCH" });
  });

  it("returns only masked account IDs and fail-closed product states", async () => {
    const fetchMock = createDashboardFetch();
    const snapshot = await loadDashboardSnapshot(credentials, fetchMock);

    expect(snapshot.accountCount).toBe(3);
    expect(snapshot.ready).toBe(false);
    expect(snapshot.accounts.map((account) => account.maskedId)).toEqual([
      "••••0001",
      "••••0002",
      "••••0003",
    ]);
    expect(snapshot.accounts.map((account) => account.product.state)).toEqual([
      "available",
      "claimed",
      "unverified",
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("game-account-0001");
    expect(JSON.stringify(snapshot)).not.toContain("dominations-bearer");
    expect(JSON.stringify(snapshot)).not.toContain("free-token-sku");
  });

  it.each([
    ["AdditionalSpecials", true],
    ["Marquee", false],
    ["WEB_SPECIALS", false],
    ["Web Specials", false],
  ])("verifies the official Web Specials tag %s: %s", async (sectionTag, verified) => {
    const snapshot = await loadDashboardSnapshot(
      credentials,
      createDashboardFetch({ sectionTag }),
    );

    expect(snapshot.accounts[0]?.product).toMatchObject({
      sectionVerified: verified,
      state: verified ? "available" : "unverified",
    });
  });
});

function createDashboardFetch({
  listedIds = accountIds,
  sectionTag = "AdditionalSpecials",
}: {
  listedIds?: string[];
  sectionTag?: string;
} = {}): typeof fetch {
  return vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/gameident/dom/list")) {
      return Response.json({ gameIds: Object.fromEntries(listedIds.map((id) => [id, {}])) });
    }
    if (url.endsWith("/api/dominations/linked_user_info")) {
      return Response.json({
        accounts: accountIds.map((gameAccountId, index) => ({
          gameAccountId,
          name: `Commander ${index + 1}`,
          age: 10 + index,
          trophies: 1_000 + index,
        })),
      });
    }

    const body = JSON.parse(String(init?.body)) as { gameAccountId: string };
    const index = accountIds.indexOf(body.gameAccountId);
    const baseProduct = {
      name: "Free Legendary Token",
      google: `free-token-sku-${index}`,
      offerId: `offer-${index}`,
      price: 0,
      currency: "USD",
      is_free: true,
      stockMax: 1,
      noInventory: false,
      disabled: false,
      locked: false,
      refresh: index === 1 ? 3_600 : 0,
      tags: index === 2 ? [] : [sectionTag],
      stockAvailable: index === 1 ? 0 : 1,
    };
    return Response.json(JSON.stringify([baseProduct]));
  });
}
