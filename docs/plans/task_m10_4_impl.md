# 구현계획서: M1.0 Issue #4 3계정 무료 토큰 일괄 수령

> 상태: **승인 완료** (2026-08-28)

## 상태

- 상태: 구현·mock 검증 완료, 운영 환경·실수령 검증 대기
- 작성자: Codex
- 범위: claim domain, Redis lock, Route Handler, dashboard UI와 테스트

## 기준 문서

- 이슈: [GitHub Issue #4](https://github.com/jg-vercel/domination-dashboard/issues/4)
- 수행계획서: `docs/plans/task_m10_4.md`
- 안전 설계: `docs/tech/task_m10_4_claim_safety_design.md`

## 구현 접근

claim Route Handler는 암호화 session·same-origin·session별 CSRF token을 먼저 확인합니다. 그 다음 cycle 단위 batch lock을 획득하고 계정 directory를 다시 조회합니다. 각 계정은 ledger 조회 → 최신 product 조회 → eligibility 검사 → account lock → `startpurchase` → product 재조회 → ledger 기록 순서로 직렬 처리합니다.

외부 호출이 전송된 뒤 오류가 나면 실패가 아닌 `uncertain`으로 기록해 자동 재시도를 막습니다. lock 소유권 해제는 Lua compare-and-delete로 본인 token과 일치할 때만 수행합니다.

## 결과 상태

| 상태 | 의미 | 자동 재시도 |
| --- | --- | --- |
| `success` | `free` 응답 후 stock/상태 변경 확인 | 금지 |
| `already_claimed` | 최신 조회에서 이미 cooldown/stock 0 | 불필요 |
| `duplicate` | 같은 cycle ledger 또는 실행 lock 존재 | 금지 |
| `ineligible` | exact/free/stock/SKU/offer 조건 실패 | 금지 |
| `failed` | 상태 변경 전 안전한 실패 | 사용자 재시도 가능 |
| `uncertain` | 상태 변경 요청 후 결과 확인 불가 | 자동 재시도 금지 |

## 변경 대상

- `.env.example`, `src/lib/auth/session.ts`
- `src/lib/idempotency/redis-rest.ts`
- `src/lib/claims/`
- `src/lib/dominations/client.ts`
- `src/app/api/claims/free-legendary-token/route.ts`
- `src/components/claim-all-button.tsx`, `src/app/page.tsx`
- 관련 unit·integration 테스트

## 검증 방법

- KST 08:59:59/09:00:00 cycle 경계 테스트
- Redis 명령에 `NX`, `EX`, owner compare-delete가 포함되는지 확인
- exact 조건 불일치 시 purchase mock 호출 0회 확인
- 계정 3개 순차 호출 순서와 ledger 결과 확인
- paid token, 401, timeout, post-check 불일치 결과 확인
- origin·CSRF·session·store 미설정 Route Handler 테스트
- lint, typecheck, unit, integration, build

## 롤백 기준

- durable lock을 획득하지 못하면 claim route를 비활성화합니다.
- `startpurchase` 응답 의미가 바뀌면 `free` 처리도 비활성화합니다.
- 상태 변경 이후 성공 여부가 불명확하면 재시도 기능을 제공하지 않습니다.

## 승인

- 소스 수정 승인자: 작업지시자
- 승인일: 2026-08-28
- 승인 범위: Vercel 실제 배포 직전까지 전 과정 자동 승인
