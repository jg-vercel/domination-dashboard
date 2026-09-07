import { describe, expect, it, vi } from "vitest";

import type { DomiNationsAccount, StoreProduct } from "@/lib/dominations/client";

import { findTargetProduct, getAccountStoreDiagnostics, getProductState, loadDashboardSnapshot, summarizeProductCatalog } from "./snapshot";

const product: StoreProduct = {
  name: "Other special", sku: "private-sku", offerId: "private-offer",
  price: 10, currency: "USD", isFree: false,
  stockAvailable: 1, stockMax: 1, noInventory: false, disabled: false,
  locked: false, refreshSeconds: 0, validUntil: null, tags: ["AdditionalSpecials"],
};

const account: DomiNationsAccount = {
  gameAccountId: "private-account", name: "Unknown commander", age: null, trophies: null, clientVersion: null,
};

describe("product catalog diagnostics", () => {
  it("counts duplicate exact-name candidates and distinct SKU/offer pairs without changing the selected item", () => {
    const first = { ...product, name: "Free Legendary Token!", sku: "private-first", offerId: "", price: 0 };
    const duplicate = { ...first, name: "Free Legendary Token" };
    const differentOffer = { ...first, offerId: "private-second-offer", stockAvailable: 0 };
    const differentSku = { ...first, sku: "private-second-sku" };
    const products = [product, first, duplicate, differentOffer, differentSku];

    const diagnostics = getAccountStoreDiagnostics(account, products);

    expect(diagnostics).toMatchObject({
      directorySource: null, profileNamePresent: null, profileFieldsPresent: null, profileErrorShape: null,
      exactTargetCandidateCount: 4, distinctSkuOfferCandidateCount: 3,
      selected: { stockAvailable: 1, stockMax: 1, skuPresent: true, offerIdPresent: false, stockGuardConflict: false },
    });
    expect(findTargetProduct(products)).toBe(first);
    expect(JSON.stringify(diagnostics)).not.toContain("private-");
    expect(JSON.stringify(diagnostics)).not.toContain("Unknown commander");
  });

  it.each([
    { stockMax: 0, stockAvailable: 0, conflict: true },
    { stockMax: null, stockAvailable: -1, conflict: true },
    { stockMax: 1, stockAvailable: 0, conflict: false },
    { stockMax: 0, stockAvailable: 1, conflict: false },
    { stockMax: 0, stockAvailable: null, conflict: false },
  ])("reports the existing stock guard anomaly without changing its state ($stockMax/$stockAvailable)", ({ stockMax, stockAvailable, conflict }) => {
    const candidate = { ...product, name: "Free Legendary Token!", price: 0, stockMax, stockAvailable, refreshSeconds: 100 };
    const before = getProductState(candidate);

    expect(getAccountStoreDiagnostics(account, [candidate]).selected).toMatchObject({
      stockMax, stockAvailable, refreshSeconds: 100, stockGuardConflict: conflict,
    });
    expect(getProductState(candidate)).toEqual(before);
    if (conflict) expect(before.state).toBe("available");
  });

  it("reports each selected restriction without making a restricted zero-stock product an availability conflict", () => {
    const candidate = { ...product, name: "Free Legendary Token!", stockMax: 0, stockAvailable: 0, disabled: true, locked: true, noInventory: true, tags: [], sku: "" };

    expect(getAccountStoreDiagnostics(account, [candidate]).selected).toMatchObject({
      disabled: true, locked: true, noInventory: true, isFree: false,
      sectionVerified: false, skuPresent: false, offerIdPresent: true, stockGuardConflict: false,
    });
  });

  it("reports no selected target for missing catalogs without inventing profile information from a name", () => {
    expect(getAccountStoreDiagnostics(account, [])).toEqual({
      directorySource: null, profileNamePresent: null, profileFieldsPresent: null, profileErrorShape: null,
      exactTargetCandidateCount: 0, distinctSkuOfferCandidateCount: 0, selected: null,
    });
  });

  it.each(["Free Legendary Token", "Free Legendary Token!", "  free legendary token!  "])("selects only the known target title %j and reports it consistently", (name) => {
    const target = { ...product, name, price: 0 };

    expect(findTargetProduct([product, target])).toBe(target);
    expect(summarizeProductCatalog([product, target])).toMatchObject({ exactTargetNameCount: 1 });
    expect(getProductState(target)).toMatchObject({ state: "available" });
  });

  it.each([
    "Small Legendary Token Special!",
    "Medium Legendary Token Special!",
    "Large Legendary Token Special!",
    "2X Small Legendary Token Special!",
    "2X Medium Legendary Token Special!",
    "2X Large Legendary Token Special!",
    "2X Free Legendary Token!",
    "Free Legendary Token!!",
    "Free Legendary Token! Bonus",
    "Free Legendary Tokens!",
    "Free Legendary Token Pack",
    "Special Free Legendary Token!",
  ])("does not select a similar or extended title %j even at zero price", (name) => {
    const candidate = { ...product, name, price: 0 };

    expect(findTargetProduct([candidate])).toBeNull();
    expect(summarizeProductCatalog([candidate])).toMatchObject({ exactTargetNameCount: 0 });
  });

  it.each(["Free Legendary Token", "Free Legendary Token!"])("retains price and restriction checks for %j", (name) => {
    const paidTarget = { ...product, name, price: 9.99, isFree: false };
    expect(findTargetProduct([paidTarget])).toBe(paidTarget);
    expect(getProductState(paidTarget)).toMatchObject({ state: "unverified", isFree: false });
    for (const flag of ["disabled", "locked", "noInventory"] as const) {
      expect(getProductState({ ...paidTarget, price: 0, [flag]: true })).toMatchObject({ state: "unavailable" });
    }
  });

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

  it("allows the exact free target with a SKU and an empty offer ID without confusing the catalog counts", () => {
    const target = { ...product, name: "Free Legendary Token!", price: 0, offerId: "" };

    expect(findTargetProduct([target])).toBe(target);
    expect(getProductState(target)).toMatchObject({ state: "available", isFree: true });
    expect(summarizeProductCatalog([target])).toMatchObject({
      exactTargetNameCount: 1, purchasableSkuCount: 1,
    });
    expect(getProductState({ ...target, sku: "" })).toMatchObject({ state: "unverified" });
    expect(summarizeProductCatalog([{ ...target, sku: "" }])).toMatchObject({ purchasableSkuCount: 0 });
  });

  it("identifies unnamed, disabled, and identifier-free catalogs without diagnosing their cause", () => {
    expect(summarizeProductCatalog([{ ...product, name: "  ", sku: "", offerId: "", disabled: true, tags: [] }])).toMatchObject({
      productCount: 1, namedProductCount: 0, webSpecialsCount: 0,
      purchasableSkuCount: 0, disabledProductCount: 1,
    });
  });

  it.each(["Free  Legendary\nToken", "Free  Legendary\nToken!"])("reports whitespace differences in %j without broadening automatic selection", (name) => {
    const candidate = { ...product, name, price: 0 };
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
    expect(info).toHaveBeenCalledWith("Store product lookup", {
      accountIndex: 1, productCount: 1, namedProductCount: 1, webSpecialsCount: 1,
      freeProductCount: 0, purchasableSkuCount: 1, disabledProductCount: 0,
      offerIdCount: 1,
      exactTargetNameCount: 0, whitespaceFoldedTargetNameCount: 0,
    });
    expect(info).toHaveBeenCalledWith("Store account diagnostics", {
      accountIndex: 1, ...snapshot.accounts[0]!.diagnostics,
    });
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/private|Private/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
