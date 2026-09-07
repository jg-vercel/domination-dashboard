import type { DashboardAccount } from "@/lib/dashboard/snapshot";

const SOURCE_LABELS = {
  listed_only: "계정 ID 목록에만 있음",
  linked_only: "연결 계정 목록에만 있음",
  both: "두 계정 목록 모두에 있음",
};

export function AccountStoreDiagnostics({ account }: { account: DashboardAccount }) {
  const diagnostics = account.diagnostics;
  const selected = diagnostics?.selected;

  return (
    <details className="product-catalog-details account-store-diagnostics">
      <summary>계정·상품 진단 (구매 없음)</summary>
      <p>페이지를 불러올 때 조회한 상태입니다. 이 내용을 펼쳐도 구매 요청을 보내지 않으며, 수령 성공을 증명하지 않습니다.</p>
      {!diagnostics ? (
        <p>이번 조회에는 진단 정보가 없습니다. 페이지를 새로고침해 확인해 주세요.</p>
      ) : (
        <>
          <dl>
            <dt>계정 출처</dt>
            <dd>{diagnostics.directorySource ? SOURCE_LABELS[diagnostics.directorySource] : "확인되지 않음"}</dd>
            <dt>응답에 이름 있음</dt>
            <dd>{flag(diagnostics.profileNamePresent)}</dd>
            <dt>프로필 필드 있음</dt>
            <dd>{flag(diagnostics.profileFieldsPresent)} (이름·시대·트로피·버전 중 하나)</dd>
            <dt>프로필 오류 형태 감지</dt>
            <dd>{flag(diagnostics.profileErrorShape)}</dd>
            <dt>정확한 상품명 후보</dt>
            <dd>{diagnostics.exactTargetCandidateCount}개</dd>
            <dt>서로 다른 SKU·offer 조합</dt>
            <dd>{diagnostics.distinctSkuOfferCandidateCount}개</dd>
          </dl>
          <p>이름이나 프로필 필드가 없다는 사실만으로 잘못된 게임 계정이라고 판단하지 않습니다. 오류 내용과 구매 식별자는 표시하지 않습니다.</p>
          {diagnostics.exactTargetCandidateCount > 1 && (
            <p>같은 상품명의 후보가 여러 개입니다. 현재는 상점 응답의 첫 후보를 사용하며, 이 진단은 선택을 변경하지 않습니다.</p>
          )}
          {selected ? (
            <>
              <p>현재 선택된 상품의 조회 값</p>
              <dl>
                <dt>남은 재고 (stockAvailable)</dt>
                <dd>{number(selected.stockAvailable)}</dd>
                <dt>재고 한도 (stockMax)</dt>
                <dd>{number(selected.stockMax)}</dd>
                <dt>갱신 대기 (refresh)</dt>
                <dd>{selected.refreshSeconds === null ? "응답 없음" : `${selected.refreshSeconds}초`}</dd>
                <dt>비활성 (disabled)</dt>
                <dd>{flag(selected.disabled)}</dd>
                <dt>잠김 (locked)</dt>
                <dd>{flag(selected.locked)}</dd>
                <dt>재고 없음 표시 (noInventory)</dt>
                <dd>{flag(selected.noInventory)}</dd>
                <dt>무료 조건</dt>
                <dd>{flag(selected.isFree)}</dd>
                <dt>Web Specials 구역</dt>
                <dd>{flag(selected.sectionVerified)}</dd>
                <dt>SKU 있음</dt>
                <dd>{flag(selected.skuPresent)}</dd>
                <dt>offer ID 있음</dt>
                <dd>{flag(selected.offerIdPresent)}</dd>
                <dt>재고 판정 차이 감지</dt>
                <dd>{flag(selected.stockGuardConflict)}</dd>
              </dl>
              {selected.stockGuardConflict && (
                <p>남은 재고가 0 이하인데 현재 대시보드는 수령 가능으로 판정했습니다. 공식 상점의 클릭 조건과 차이가 있어 확인이 필요합니다.</p>
              )}
              <p>빈 offer ID만으로 수령 불가를 뜻하지는 않습니다. 조회 값과 실제 수령 가능 여부는 다를 수 있습니다.</p>
            </>
          ) : (
            <p>정확한 상품명에 해당하는 선택 후보가 없습니다.</p>
          )}
        </>
      )}
    </details>
  );
}

function flag(value: boolean | null): string {
  return value === null ? "확인되지 않음" : value ? "예" : "아니요";
}

function number(value: number | null): string {
  return value === null ? "응답 없음" : String(value);
}
