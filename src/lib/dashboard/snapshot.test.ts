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
  it.each([0, 1, 2, 4, 6])("loads all %i accounts without a fixed-count requirement", async (count) => {
    const ids = Array.from({ length: count }, (_, index) => `account-${index}`);
    const fetchMock = createDashboardFetch({ listedIds: ids, linkedIds: ids });

    const accounts = await loadAccountDirectory(credentials, fetchMock);

    expect(accounts.map((account) => account.gameAccountId)).toEqual(ids);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("unions both account sources in listed order, preserving linked metadata and adding linked-only accounts", async () => {
    const fetchMock = createDashboardFetch({
      listedIds: ["direct-only", "shared"],
      linkedIds: ["linked-only", "shared"],
    });

    const accounts = await loadAccountDirectory(credentials, fetchMock);

    expect(accounts.map((account) => account.gameAccountId)).toEqual([
      "direct-only", "shared", "linked-only",
    ]);
    expect(accounts).toEqual([
      expect.objectContaining({ gameAccountId: "direct-only", name: "Direct direct-only", age: 15, trophies: 2000 }),
      expect.objectContaining({ gameAccountId: "shared", name: "Commander 2", age: 11, trophies: 1001 }),
      expect.objectContaining({ gameAccountId: "linked-only", name: "Commander 1", age: 10, trophies: 1000 }),
    ]);
    const userInfoCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/user_info"));
    expect(userInfoCalls).toHaveLength(1);
    expect(String(userInfoCalls[0]?.[0])).toBe("https://api.dominationsworld.com/api/dominations/direct-only/user_info");
  });

  it("fetches missing metadata with an encoded account ID and authenticated GET", async () => {
    const id = "account/with?reserved#characters";
    const fetchMock = createDashboardFetch({ listedIds: [id], linkedIds: [] });

    const accounts = await loadAccountDirectory(credentials, fetchMock);

    expect(accounts[0]).toMatchObject({ gameAccountId: id, name: `Direct ${id}` });
    const request = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/user_info"));
    expect(String(request?.[0])).toBe(`https://api.dominationsworld.com/api/dominations/${encodeURIComponent(id)}/user_info`);
    expect(request?.[1]?.method ?? "GET").toBe("GET");
    const headers = new Headers(request?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer dominations-bearer");
    expect(headers.get("cookie")).toBe("domi=session");
  });

  it("keeps the requested account ID when fallback metadata contains a different ID", async () => {
    const fetchMock = createDashboardFetch({
      listedIds: ["requested-account"],
      linkedIds: [],
      userInfoResponse: () => Response.json({ gameAccountId: "different-account", name: "Commander" }),
    });

    await expect(loadAccountDirectory(credentials, fetchMock)).resolves.toEqual([
      expect.objectContaining({ gameAccountId: "requested-account", name: "Commander" }),
    ]);
  });

  it.each([null, [], "invalid", 1])("rejects malformed fallback metadata (%j) without dropping the account", async (payload) => {
    const fetchMock = createDashboardFetch({
      listedIds: ["requested-account"],
      linkedIds: [],
      userInfoResponse: () => Response.json(payload),
    });

    await expect(loadAccountDirectory(credentials, fetchMock)).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it.each([
    { listedIds: ["account-1"], linkedIds: ["account-1", "account-1"] },
    { listedIds: ["account-1", "account-1"], linkedIds: ["account-1"], legacyListedIds: true },
  ])("rejects duplicate IDs within either source: %j", async (directory) => {
    const fetchMock = createDashboardFetch(directory);

    await expect(loadAccountDirectory(credentials, fetchMock)).rejects.toMatchObject({
      code: "ACCOUNT_DIRECTORY_INVALID",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not report an empty snapshot ready or request any products", async () => {
    const fetchMock = createDashboardFetch({ listedIds: [], linkedIds: [] });

    await expect(loadDashboardSnapshot(credentials, fetchMock)).resolves.toMatchObject({
      ready: false, accountCount: 0, accounts: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
  linkedIds = accountIds,
  legacyListedIds = false,
  userInfoResponse,
  sectionTag = "AdditionalSpecials",
}: {
  listedIds?: string[];
  linkedIds?: string[];
  legacyListedIds?: boolean;
  userInfoResponse?: () => Response;
  sectionTag?: string;
} = {}) {
  return vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/gameident/dom/list")) {
      return Response.json({ gameIds: legacyListedIds ? listedIds : Object.fromEntries(listedIds.map((id) => [id, {}])) });
    }
    if (url.endsWith("/api/dominations/linked_user_info")) {
      return Response.json({
        accounts: linkedIds.map((gameAccountId, index) => ({
          gameAccountId,
          name: `Commander ${index + 1}`,
          age: 10 + index,
          trophies: 1_000 + index,
        })),
      });
    }
    const userInfoPath = new URL(url).pathname.match(/^\/api\/dominations\/([^/]+)\/user_info$/);
    if (userInfoPath) {
      if (userInfoResponse) return userInfoResponse();
      const id = decodeURIComponent(userInfoPath[1]!);
      return Response.json({ name: `Direct ${id}`, age: 15, trophies: 2000, clientMajorVersion: "12" });
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
