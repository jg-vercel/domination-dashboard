import { describe, expect, it, vi } from "vitest";

import type { StoreProduct } from "@/lib/dominations/client";

import { findTargetProduct, loadDashboardSnapshot, summarizeProductCatalog } from "./snapshot";

const product: StoreProduct = {
  name: "Other special", sku: "private-sku", offerId: "private-offer",
  price: 10, currency: "USD", isFree: false,
  stockAvailable: 1, stockMax: 1, noInventory: false, disabled: false,
  locked: false, refreshSeconds: 0, validUntil: null, tags: ["AdditionalSpecials"],
};

describe("product catalog diagnostics", () => {
  it("distinguishes empty catalogs from named products without the target", () => {
    expect(summarizeProductCatalog([])).toMatchObject({
      productCount: 0, namedProductCount: 0, webSpecialsCount: 0,
      exactTargetNameCount: 0, webSpecials: [], webSpecialsTruncated: false,
    });
    expect(summarizeProductCatalog([product])).toMatchObject({
      productCount: 1, namedProductCount: 1, webSpecialsCount: 1,
      exactTargetNameCount: 0, freeProductCount: 0, purchasableSkuCount: 1,
    });
  });

  it("identifies unnamed, disabled, and identifier-free catalogs without diagnosing their cause", () => {
    expect(summarizeProductCatalog([{ ...product, name: "  ", sku: "", offerId: "", disabled: true, tags: [] }])).toMatchObject({
      productCount: 1, namedProductCount: 0, webSpecialsCount: 0,
      purchasableSkuCount: 0, disabledProductCount: 1,
    });
  });

  it("reports whitespace differences without broadening automatic product selection", () => {
    const candidate = { ...product, name: "Free  Legendary\nToken", price: 0 };
    expect(summarizeProductCatalog([candidate])).toMatchObject({
      exactTargetNameCount: 0, whitespaceFoldedTargetNameCount: 1, freeProductCount: 1,
    });
    expect(findTargetProduct([candidate])).toBeNull();
  });

  it("caps visible specials and strips purchase identifiers from the summary", () => {
    const summary = summarizeProductCatalog(Array.from({ length: 35 }, () => ({
      ...product, name: "x".repeat(200), currency: "c".repeat(30),
    })));
    expect(summary.webSpecialsCount).toBe(35);
    expect(summary.webSpecials).toHaveLength(30);
    expect(summary.webSpecialsTruncated).toBe(true);
    expect(summary.webSpecials[0]?.name).toHaveLength(120);
    expect(summary.webSpecials[0]?.currency).toHaveLength(12);
    expect(JSON.stringify(summary)).not.toContain(product.sku);
    expect(JSON.stringify(summary)).not.toContain(product.offerId);
  });

  it("logs only aggregate counts when a target is missing", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input).endsWith("/dom/list")) return Response.json({ gameIds: { "private-account": {} } });
      if (String(input).endsWith("/linked_user_info")) return Response.json({ accounts: [{ gameAccountId: "private-account", name: "private-commander" }] });
      return Response.json(JSON.stringify([{ name: "Private product name", google: product.sku, offerId: product.offerId, price: 10, tags: ["AdditionalSpecials"] }]));
    });
    const snapshot = await loadDashboardSnapshot({ accessToken: "private-token", cookies: ["private-cookie"], userId: "private-user", xsollaId: "private-xsolla" }, fetchMock);

    expect(snapshot.accounts[0]?.product.state).toBe("missing");
    expect(info).toHaveBeenCalledExactlyOnceWith("Store product lookup", {
      accountIndex: 1, productCount: 1, namedProductCount: 1, webSpecialsCount: 1,
      freeProductCount: 0, purchasableSkuCount: 1, disabledProductCount: 0,
      exactTargetNameCount: 0, whitespaceFoldedTargetNameCount: 0,
    });
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/private|Private/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
