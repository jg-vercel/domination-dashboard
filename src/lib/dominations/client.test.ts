import { describe, expect, it, vi } from "vitest";

import type { DomiNationsCredential } from "@/lib/auth/session";
import { getProductState } from "@/lib/dashboard/snapshot";

import {
  connectDomiNations,
  connectDomiNationsWithXsollaToken,
  getLinkedAccounts,
  getProductsForAccount,
  listGameAccountIds,
  startFreePurchase,
} from "./client";

const credentials: DomiNationsCredential = {
  accessToken: "dominations-bearer",
  cookies: ["domi_cookie=session-value"],
  userId: "user-1",
  xsollaId: "xsolla-1",
};

describe("DomiNations authentication adapter", () => {
  it("exchanges Google -> Xsolla -> DomiNations while carrying the cookie jar", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "xsolla-jwt" }))
      .mockResolvedValueOnce(
        Response.json(
          { authcode: "domi-auth-code", existing: true },
          { headers: { "Set-Cookie": "auth_flow=flow-cookie; Path=/; HttpOnly" } },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { token: "domi-bearer", userid: "user-1", xsid: "xsolla-1" },
          { headers: { "Set-Cookie": "domi_session=session-cookie; Path=/; HttpOnly" } },
        ),
      );

    await expect(
      connectDomiNations("google-access-token", fetchMock),
    ).resolves.toEqual({
      accessToken: "domi-bearer",
      cookies: ["auth_flow=flow-cookie", "domi_session=session-cookie"],
      userId: "user-1",
      xsollaId: "xsolla-1",
    });

    const xsollaRequest = fetchMock.mock.calls[0];
    expect(String(xsollaRequest?.[0])).toContain(
      "/api/social/google/login_with_token",
    );
    expect(xsollaRequest?.[1]?.body).toBe(
      JSON.stringify({ access_token: "google-access-token" }),
    );

    const signupBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(signupBody).toMatchObject({
      jwt: "xsolla-jwt",
      password: "",
      scope: "",
      state: "",
    });
    expect(signupBody.codeChallenge).toEqual(expect.any(String));

    const tokenHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(tokenHeaders.get("Cookie")).toBe("auth_flow=flow-cookie");
  });

  it("exchanges a valid signup code when errorReason is an empty string", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "xsolla-jwt" }))
      .mockResolvedValueOnce(
        Response.json({ errorReason: "", authcode: "domi-auth-code" }),
      )
      .mockResolvedValueOnce(
        Response.json({ token: "domi-bearer", userid: "user-1", xsid: "xsolla-1" }),
      );

    await expect(
      connectDomiNations("google-access-token", fetchMock),
    ).resolves.toMatchObject({ accessToken: "domi-bearer", userId: "user-1" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/api/accounts/token");
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      code: "domi-auth-code",
    });
  });

  it.each([
    {
      description: "a recognized nonempty error even with a code",
      payload: { errorReason: "wrongCredentials", authcode: "private-auth-code" },
      reason: "wrongCredentials",
      authcodePresent: true,
    },
    {
      description: "a missing authorization code",
      payload: { errorReason: "" },
      reason: "empty",
      authcodePresent: false,
    },
    {
      description: "an empty authorization code",
      payload: { authcode: "" },
      reason: "absent",
      authcodePresent: false,
    },
    {
      description: "a whitespace-only authorization code",
      payload: { authcode: "   " },
      reason: "absent",
      authcodePresent: false,
    },
    {
      description: "a malformed authorization code",
      payload: { authcode: 123 },
      reason: "absent",
      authcodePresent: false,
    },
    {
      description: "a null error reason",
      payload: { errorReason: null, authcode: "private-auth-code" },
      reason: "malformed",
      authcodePresent: true,
    },
    {
      description: "an object error reason",
      payload: {
        errorReason: { token: "private-upstream-value" },
        authcode: "private-auth-code",
      },
      reason: "malformed",
      authcodePresent: true,
    },
    {
      description: "an unknown sensitive error reason",
      payload: {
        errorReason: "private-upstream-value",
        authcode: "private-auth-code",
      },
      reason: "unknown",
      authcodePresent: true,
    },
  ])("rejects $description before token exchange", async ({ payload, reason, authcodePresent }) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(payload));

    try {
      await expect(
        connectDomiNationsWithXsollaToken("private-xsolla-jwt", fetchMock),
      ).rejects.toMatchObject({ code: "DOMINATIONS_SIGNUP_REJECTED" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledWith("Upstream authentication rejected", {
        stage: "dominations_signup",
        status: 200,
        reason,
        authcodePresent,
      });
      const diagnostic = JSON.stringify(warning.mock.calls);
      expect(diagnostic).not.toContain("private-auth-code");
      expect(diagnostic).not.toContain("private-upstream-value");
      expect(diagnostic).not.toContain("private-xsolla-jwt");
    } finally {
      warning.mockRestore();
    }
  });

  it("identifies an Xsolla Google token rejection without logging secrets", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("private provider response", { status: 401 }),
    );

    try {
      await expect(
        connectDomiNations("private-google-access-token", fetchMock),
      ).rejects.toMatchObject({ code: "XSOLLA_GOOGLE_TOKEN_REJECTED" });
      expect(warning).toHaveBeenCalledWith("Upstream authentication rejected", {
        stage: "xsolla_google_token",
        status: 401,
      });
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        "private-google-access-token",
      );
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        "private provider response",
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("identifies a DomiNations signup rejection without logging secrets", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "private-xsolla-jwt" }))
      .mockResolvedValueOnce(
        new Response("private signup response", { status: 403 }),
      );

    try {
      await expect(
        connectDomiNations("private-google-access-token", fetchMock),
      ).rejects.toMatchObject({ code: "DOMINATIONS_SIGNUP_REJECTED" });
      expect(warning).toHaveBeenCalledWith("Upstream authentication rejected", {
        stage: "dominations_signup",
        status: 403,
      });
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private-xsolla-jwt");
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        "private signup response",
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("identifies a DomiNations token rejection without logging secrets", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "private-xsolla-jwt" }))
      .mockResolvedValueOnce(
        Response.json(
          { authcode: "private-domi-auth-code" },
          { headers: { "Set-Cookie": "private-flow-cookie=value" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response("private token response", { status: 422 }),
      );

    try {
      await expect(
        connectDomiNations("private-google-access-token", fetchMock),
      ).rejects.toMatchObject({ code: "DOMINATIONS_TOKEN_REJECTED" });
      expect(warning).toHaveBeenCalledWith("Upstream authentication rejected", {
        stage: "dominations_token",
        status: 422,
      });
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        "private-domi-auth-code",
      );
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        "private token response",
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("connects an official Xsolla session without repeating Google exchange", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { authcode: "domi-auth-code" },
          { headers: { "Set-Cookie": "auth_flow=flow-cookie; Path=/" } },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ token: "domi-bearer", userid: "user-1", xsid: "xsolla-1" }),
      );

    await expect(
      connectDomiNationsWithXsollaToken("official-xsolla-jwt", fetchMock),
    ).resolves.toMatchObject({ accessToken: "domi-bearer", userId: "user-1" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/accounts/signup");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("login.xsolla.com");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      jwt: "official-xsolla-jwt",
    });
  });

  it("uses bearer and cookie credentials for account and product reads", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer dominations-bearer");
      expect(headers.get("Cookie")).toBe("domi_cookie=session-value");

      if (url.endsWith("/api/gameident/dom/list")) {
        return Response.json({
          gameIds: { "account-1": {}, "account-2": {}, "account-3": {} },
        });
      }
      if (url.endsWith("/api/dominations/linked_user_info")) {
        return Response.json({
          accounts: [
            { gameAccountId: "account-1", name: "One", age: 12, trophies: 100 },
          ],
        });
      }
      return Response.json(
        JSON.stringify([
          {
            name: "Free Legendary Token",
            google: "free-token-sku",
            offerId: "offer-1",
            price: 0,
            currency: "USD",
            is_free: true,
            stockAvailable: 1,
            stockMax: 1,
            tags: ["AdditionalSpecials"],
          },
        ]),
      );
    });

    await expect(listGameAccountIds(credentials, fetchMock)).resolves.toHaveLength(3);
    await expect(getLinkedAccounts(credentials, fetchMock)).resolves.toEqual([
      expect.objectContaining({ gameAccountId: "account-1", name: "One" }),
    ]);
    await expect(
      getProductsForAccount(credentials, "account-1", fetchMock),
    ).resolves.toEqual([
      expect.objectContaining({
        name: "Free Legendary Token",
        sku: "free-token-sku",
        isFree: true,
      }),
    ]);
  });

  it("maps a 401 to session expiry without returning the upstream body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("private upstream response", { status: 401 }),
    );

    await expect(
      listGameAccountIds(credentials, fetchMock),
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("reads game account IDs from the official dictionary response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        gameIds: { "account-1": {}, "account-2": {}, "account-3": {} },
      }),
    );

    await expect(listGameAccountIds(credentials, fetchMock)).resolves.toEqual([
      "account-1", "account-2", "account-3",
    ]);
  });

  it("retains compatibility with a valid legacy account ID array", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ gameIds: ["account-1", "account-2", "account-3"] }),
    );

    await expect(listGameAccountIds(credentials, fetchMock)).resolves.toEqual([
      "account-1", "account-2", "account-3",
    ]);
  });

  it.each([{}, []])("returns an empty account list for a valid empty container (%j)", async (gameIds) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ gameIds }));

    await expect(listGameAccountIds(credentials, fetchMock)).resolves.toEqual([]);
  });

  it.each([
    { description: "a missing dictionary", gameIds: undefined },
    { description: "a null dictionary", gameIds: null },
    { description: "a string dictionary", gameIds: "account-1" },
    { description: "a numeric dictionary", gameIds: 1 },
    { description: "a boolean dictionary", gameIds: true },
    { description: "an empty dictionary key", gameIds: { "": {} } },
    { description: "a whitespace-only dictionary key", gameIds: { "   ": {} } },
    { description: "a null dictionary value", gameIds: { "account-1": null } },
    { description: "an array dictionary value", gameIds: { "account-1": [] } },
    { description: "a string dictionary value", gameIds: { "account-1": "data" } },
    { description: "a numeric dictionary value", gameIds: { "account-1": 1 } },
    { description: "a boolean dictionary value", gameIds: { "account-1": true } },
    { description: "an empty array ID", gameIds: ["account-1", ""] },
    { description: "a whitespace-only array ID", gameIds: ["account-1", "   "] },
    { description: "a numeric array ID", gameIds: ["account-1", 1] },
    { description: "a null array ID", gameIds: ["account-1", null] },
    { description: "an object array ID", gameIds: ["account-1", {}] },
  ])("rejects $description instead of silently filtering IDs", async ({ gameIds }) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ gameIds }));

    await expect(listGameAccountIds(credentials, fetchMock)).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it.each([
    { description: "null", price: null },
    { description: "missing", price: undefined },
    { description: "empty", price: "" },
    { description: "whitespace-only", price: " \t\n " },
    { description: "false", price: false },
    { description: "true", price: true },
    { description: "an array", price: [] },
    { description: "an object", price: {} },
  ])("does not normalize $description price into a free product", async ({ price }) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json([
      { name: "Free Legendary Token", google: "token-sku", offerId: "token-offer", price },
    ]));

    const [product] = await getProductsForAccount(credentials, "account-1", fetchMock);

    expect(product).toMatchObject({ price: null, isFree: false });
    const purchaseFetch = vi.fn<typeof fetch>();
    await expect(
      startFreePurchase(credentials, "account-1", product!, purchaseFetch),
    ).rejects.toMatchObject({ code: "PURCHASE_NOT_ELIGIBLE" });
    expect(purchaseFetch).not.toHaveBeenCalled();
  });

  it.each([0, "0", " 0 "])("preserves an explicitly zero price (%j)", async (price) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json([
      { name: "Free Legendary Token", google: "token-sku", offerId: "token-offer", price },
    ]));

    await expect(getProductsForAccount(credentials, "account-1", fetchMock)).resolves.toEqual([
      expect.objectContaining({ price: 0 }),
    ]);
  });

  describe.each(["disabled", "noInventory", "locked"] as const)("%s purchase restriction", (flag) => {
    it.each([
      { description: "missing", value: undefined, restricted: false },
      { description: "null", value: null, restricted: false },
      { description: "boolean false", value: false, restricted: false },
      { description: "numeric zero", value: 0, restricted: false },
      { description: "string zero", value: "0", restricted: false },
      { description: "empty string", value: "", restricted: false },
      { description: "whitespace-only string", value: " \t\n ", restricted: false },
      { description: "boolean true", value: true, restricted: true },
      { description: "numeric one", value: 1, restricted: true },
      { description: "string one", value: "1", restricted: true },
      { description: "unknown string", value: "unknown", restricted: true },
      { description: "string false", value: "false", restricted: true },
      { description: "noncanonical zero string", value: " 0 ", restricted: true },
      { description: "another positive number", value: 2, restricted: true },
      { description: "negative number", value: -1, restricted: true },
      { description: "NaN", value: Number.NaN, restricted: true },
      { description: "infinity", value: Number.POSITIVE_INFINITY, restricted: true },
      { description: "empty array", value: [], restricted: true },
      { description: "object", value: {}, restricted: true },
    ])("normalizes $description fail-closed and prevents restricted purchases", async ({ value, restricted }) => {
      const response = Response.json([]);
      // Mock the decoded response so NaN/undefined are not changed by JSON serialization.
      vi.spyOn(response, "json").mockResolvedValue([
        {
          name: "Free Legendary Token",
          google: "token-sku",
          offerId: "token-offer",
          price: 0,
          stockAvailable: 1,
          stockMax: 1,
          tags: ["AdditionalSpecials"],
          [flag]: value,
        },
      ]);
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);

      const [product] = await getProductsForAccount(credentials, "account-1", fetchMock);

      expect(product?.[flag]).toBe(restricted);
      expect(getProductState(product!)).toMatchObject({ state: restricted ? "unavailable" : "available" });
      if (restricted) {
        const purchaseFetch = vi.fn<typeof fetch>();
        await expect(startFreePurchase(credentials, "account-1", product!, purchaseFetch)).rejects.toMatchObject({
          code: "PURCHASE_NOT_ELIGIBLE",
        });
        expect(purchaseFetch).not.toHaveBeenCalled();
      }
    });
  });

  it.each([1, "1", "true", "false", {}, [], null, undefined])("does not treat nonboolean is_free (%j) as permission to purchase", async (isFree) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json([
      { name: "Free Legendary Token", google: "token-sku", offerId: "token-offer", price: 9.99, is_free: isFree },
    ]));

    const [product] = await getProductsForAccount(credentials, "account-1", fetchMock);

    expect(product?.isFree).toBe(false);
    const purchaseFetch = vi.fn<typeof fetch>();
    await expect(startFreePurchase(credentials, "account-1", product!, purchaseFetch)).rejects.toMatchObject({
      code: "PURCHASE_NOT_ELIGIBLE",
    });
    expect(purchaseFetch).not.toHaveBeenCalled();
  });

  it("starts only a free purchase with the fixed safe request body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ orderAccessToken: "free" }));
    const product = {
      name: "Free Legendary Token",
      sku: "free-token-sku",
      offerId: "free-token-offer",
      price: 0,
      currency: "USD",
      isFree: true,
      stockAvailable: 1,
      stockMax: 1,
      noInventory: false,
      disabled: false,
      locked: false,
      refreshSeconds: 0,
      validUntil: null,
      tags: ["AdditionalSpecials"],
    };

    await expect(
      startFreePurchase(credentials, "account-1", product, fetchMock),
    ).resolves.toBe("free");

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      gameAccountId: "account-1",
      itemSku: "free-token-sku",
      offerId: "free-token-offer",
      quantity: 1,
      locale: "en-US",
      returnToken: true,
      targetUserHash: "",
      domgl: false,
      anonymize: false,
      projectId: 277239,
    });
  });

  it("rejects paid checkout tokens and blocks non-free products before fetch", async () => {
    const freeProduct = {
      name: "Free Legendary Token",
      sku: "free-token-sku",
      offerId: "free-token-offer",
      price: 0,
      currency: "USD",
      isFree: true,
      stockAvailable: 1,
      stockMax: 1,
      noInventory: false,
      disabled: false,
      locked: false,
      refreshSeconds: 0,
      validUntil: null,
      tags: ["AdditionalSpecials"],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ orderAccessToken: "paid-checkout-token" }));

    await expect(
      startFreePurchase(credentials, "account-1", freeProduct, fetchMock),
    ).rejects.toMatchObject({ code: "PAID_CHECKOUT_REJECTED" });

    const blockedFetch = vi.fn<typeof fetch>();
    await expect(
      startFreePurchase(
        credentials,
        "account-1",
        { ...freeProduct, price: 9.99, isFree: false },
        blockedFetch,
      ),
    ).rejects.toMatchObject({ code: "PURCHASE_NOT_ELIGIBLE" });
    expect(blockedFetch).not.toHaveBeenCalled();
  });
});
