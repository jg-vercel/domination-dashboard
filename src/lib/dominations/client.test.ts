import { describe, expect, it, vi } from "vitest";

import type { DomiNationsCredential } from "@/lib/auth/session";

import {
  connectDomiNations,
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

  it("uses bearer and cookie credentials for account and product reads", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer dominations-bearer");
      expect(headers.get("Cookie")).toBe("domi_cookie=session-value");

      if (url.endsWith("/api/gameident/dom/list")) {
        return Response.json({ gameIds: ["account-1", "account-2", "account-3"] });
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
            tags: ["WEB_SPECIALS"],
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
      tags: ["WEB_SPECIALS"],
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
      tags: ["WEB_SPECIALS"],
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
