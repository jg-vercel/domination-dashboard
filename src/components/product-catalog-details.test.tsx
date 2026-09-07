import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DashboardAccount } from "@/lib/dashboard/snapshot";
import { ProductCatalogDetails } from "./product-catalog-details";

const catalog: DashboardAccount["catalog"] = {
  productCount: 10,
  namedProductCount: 10,
  webSpecialsCount: 0,
  freeProductCount: 0,
  purchasableSkuCount: 0,
  disabledProductCount: 10,
  exactTargetNameCount: 0,
  whitespaceFoldedTargetNameCount: 0,
  webSpecials: [],
  webSpecialsTruncated: false,
};

const special: DashboardAccount["catalog"]["webSpecials"][number] = {
  name: "<img src=x onerror=alert(1)>",
  price: 0,
  currency: "USD",
  isFree: true,
  stockAvailable: 1,
  disabled: false,
  locked: false,
  noInventory: false,
};

describe("ProductCatalogDetails", () => {
  afterEach(cleanup);

  it("distinguishes an empty response without claiming the item does not exist", () => {
    render(<ProductCatalogDetails catalog={{ ...catalog, productCount: 0, namedProductCount: 0, disabledProductCount: 0 }} />);

    expect(screen.getByText("상점이 이번 조회에서 상품을 반환하지 않았습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/Free Legendary Token/)).not.toBeInTheDocument();
    expect(screen.queryByText("현재 Web Specials 상품 확인")).not.toBeInTheDocument();
  });

  it("shows the returned catalog counts when the target is absent", () => {
    render(<ProductCatalogDetails catalog={catalog} />);

    expect(screen.getByText("전체 상품 10개 · Web Specials 0개 · 무료 0개")).toBeInTheDocument();
    expect(screen.getByText("이번 상점 응답에서 Free Legendary Token을 확인하지 못했습니다.")).toBeInTheDocument();
    const details = screen.getByText("현재 Web Specials 상품 확인").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("이번 응답에는 Web Specials 상품이 포함되지 않았습니다.")).toBeInTheDocument();
  });

  it("renders actual special names as text with prices and unavailable states", () => {
    const { container } = render(<ProductCatalogDetails catalog={{
      ...catalog,
      webSpecialsCount: 3,
      freeProductCount: 1,
      webSpecials: [
        special,
        { ...special, name: "Special Bundle", price: 4.99, isFree: false, disabled: true },
        { ...special, name: "Unknown Price", price: null, isFree: false, locked: true },
      ],
    }} />);

    const rows = screen.getAllByRole("listitem", { hidden: true });
    expect(within(rows[0]!).getByText(special.name)).toBeInTheDocument();
    expect(within(rows[0]!).getByText("무료")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("4.99 USD")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("현재 수령 불가")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("가격 확인 필요")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("잠김")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("explains a bounded list without implying all products are shown", () => {
    render(<ProductCatalogDetails catalog={{
      ...catalog,
      productCount: 31,
      namedProductCount: 31,
      webSpecialsCount: 31,
      webSpecials: Array.from({ length: 30 }, (_, index) => ({ ...special, name: `Special ${index + 1}` })),
      webSpecialsTruncated: true,
    }} />);

    expect(screen.getByText("Web Specials 31개 중 처음 30개를 표시합니다.")).toBeInTheDocument();
  });
});
