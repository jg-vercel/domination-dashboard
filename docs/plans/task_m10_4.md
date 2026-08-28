# 수행계획서: M1.0 Issue #4 3계정 무료 토큰 일괄 수령

> 상태: **승인 완료** (2026-08-28)

## 상태

- 상태: 구현·mock 검증 완료, 운영 환경·실수령 검증 대기
- 작성자: Codex
- 범위: 사용자 버튼 기반 3계정 순차 무료 수령, 중복 방지, 결과 확인

## 기준 문서

- 이슈: [GitHub Issue #4](https://github.com/jg-vercel/domination-dashboard/issues/4)
- 할일: `docs/orders/20260828.md`
- Preview: `docs/working/preview_us_web_store_purchase.md`
- 인증 설계: `docs/tech/task_m10_3_auth_session_design.md`

## 목적

인증된 관리자가 버튼을 한 번 눌렀을 때 정확히 연결된 게임 계정 3개를 순차 처리합니다. 매 계정마다 최신 상품을 다시 조회하고 exact 상품·Web Specials·무료·재고를 모두 확인한 뒤에만 공식 `startpurchase` 요청을 전송합니다.

## 수행 범위

### 포함

- 한국 시간 오전 9시 기준 일일 cycle key
- Upstash Redis REST `SET NX EX` 기반 batch/account lock
- cycle·계정·상품별 durable result ledger
- exact item/SKU/offer/free/stock의 요청 직전 재검증
- `orderAccessToken=free`만 성공으로 허용
- 성공 후 상품 재조회와 confirmed/uncertain 구분
- 관리자 session, same-origin, CSRF token 검증
- 계정 3개 순차 처리와 사용자 UI 결과 표시

### 제외

- scheduler, cron, 무인 실행
- 유료 checkout token 처리
- 이미 수령된 계정 재요청
- 계정 수·가격·재고·session·lock 우회
- 실계정 수령 실행과 Vercel 배포

## 단계

1. cycle·결과 상태·Redis key 보안 경계를 문서화합니다.
2. Redis REST atomic lock·ledger와 fail-closed readiness를 구현합니다.
3. DomiNations 무료 수령 adapter와 paid-token 차단을 구현합니다.
4. 3계정 orchestration과 성공 후 재확인을 구현합니다.
5. claim Route Handler의 session·origin·CSRF 검증을 구현합니다.
6. dashboard 버튼과 결과 UI를 연결합니다.
7. 외부 상태 변경은 mock으로만 검증하고 실제 실행 조건을 기록합니다.

## 산출물

- `docs/tech/task_m10_4_claim_safety_design.md`
- `src/lib/claims/`, `src/lib/idempotency/`
- `src/app/api/claims/free-legendary-token/route.ts`
- 실제 claim button과 결과 UI
- `docs/working/task_m10_4_test_result.md`

## 위험 및 대응

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| serverless 동시 요청 | 계정별 중복 수령 | 외부 Redis atomic batch/account lock 필수 |
| 응답 유실 후 재시도 | 실제 성공을 실패로 오인해 중복 | uncertain ledger를 남기고 자동 재시도 금지 |
| 유료 checkout token 반환 | 의도하지 않은 결제 흐름 | 문자열 `free` 외 모든 token 즉시 거부 |
| 상품 schema·SKU 변경 | 다른 상품 수령 | 매 요청 직전 exact name/tag/free/SKU/offer 재확인 |
| Redis 장애·미설정 | 중복 방지 불가 | claim endpoint 503 fail-closed |

## 완료 기준

- cycle 경계와 동시성·idempotency 테스트가 통과합니다.
- 3개 계정이 순차 실행되고 각 결과가 6개 상태로 구분됩니다.
- 유료·미확인 상품에는 상태 변경 요청이 전송되지 않습니다.
- raw credential/full gameAccountId/Redis token/upstream body가 client·로그에 노출되지 않습니다.
- 실 수령은 환경 구성과 사용자 버튼 전까지 실행되지 않습니다.

## 승인

- 승인자: 작업지시자
- 승인일: 2026-08-28
- 승인 범위: Vercel 실제 배포 직전까지 전 과정 자동 승인
