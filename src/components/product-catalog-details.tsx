import type { DashboardAccount } from "@/lib/dashboard/snapshot";

type ProductCatalog = DashboardAccount["catalog"];
type CatalogProduct = ProductCatalog["webSpecials"][number];

export function ProductCatalogDetails({ catalog }: { catalog: ProductCatalog }) {
  if (catalog.productCount === 0) {
    return (
      <section className="product-catalog-details" aria-label="상점 상품 확인">
        <p>상점이 이번 조회에서 상품을 반환하지 않았습니다.</p>
        <p>계정 연결을 새로고침한 뒤 다시 확인해 주세요.</p>
      </section>
    );
  }

  return (
    <section className="product-catalog-details" aria-label="상점 상품 확인">
      <p>이번 상점 응답에서 Free Legendary Token을 확인하지 못했습니다.</p>
      <p className="product-catalog-counts">
        전체 상품 {catalog.productCount}개 · Web Specials {catalog.webSpecialsCount}개 · 무료 {catalog.freeProductCount}개
      </p>
      <details>
        <summary>현재 Web Specials 상품 확인</summary>
        {catalog.webSpecials.length > 0 ? (
          <ul className="product-catalog-list">
            {catalog.webSpecials.map((product, index) => (
              <li key={`${index}:${product.name}`}>
                <span>{product.name || "상품명 확인 필요"}</span>
                <span className="product-catalog-price">{formatPrice(product)}</span>
                {(product.disabled || product.locked || product.noInventory) && (
                  <span className="product-catalog-availability">
                    {product.noInventory ? "품절" : product.locked ? "잠김" : "현재 수령 불가"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>이번 응답에는 Web Specials 상품이 포함되지 않았습니다.</p>
        )}
        {catalog.webSpecialsTruncated && (
          <p>Web Specials {catalog.webSpecialsCount}개 중 처음 {catalog.webSpecials.length}개를 표시합니다.</p>
        )}
      </details>
    </section>
  );
}

function formatPrice(product: CatalogProduct): string {
  if (product.isFree || product.price === 0) return "무료";
  if (product.price === null) return "가격 확인 필요";
  return `${product.price.toLocaleString("ko-KR")} ${product.currency}`.trim();
}
