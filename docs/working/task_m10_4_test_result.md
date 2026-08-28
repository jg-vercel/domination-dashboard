# 테스트 결과: M1.0 Issue #4 3계정 무료 토큰 일괄 수령

## 상태

- 상태: 로컬·mock 검증 승인 완료, 운영 Redis·실수령 검증 대기
- 작성자: Codex
- 범위: cycle, Redis lock/ledger, purchase adapter, 3계정 orchestration, claim API·UI

## 기준 문서

- 수행계획서: `docs/plans/task_m10_4.md`
- 구현계획서: `docs/plans/task_m10_4_impl.md`
- 안전 설계: `docs/tech/task_m10_4_claim_safety_design.md`

## 실행 환경

- 브랜치: `local/task4`
- 실행일: 2026-08-28
- 배포 호환 검증: Node.js `24.20.0`, pnpm `11.24.0`

## 실행 결과

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `pnpm lint` | 통과 | ESLint 오류 없음 |
| `pnpm typecheck` | 통과 | TypeScript 오류 없음 |
| `pnpm test` | 통과 | 11 files, 43 tests |
| `pnpm test:integration` | 통과 | 3 files, 11 tests |
| `pnpm build` | 통과 | claim Route Handler 포함 동적 route 7개 |

## 검증한 기능·안전 조건

- KST 08:59:59는 전 cycle, 09:00:00은 새 cycle로 계산됩니다.
- Redis lock은 `SET key owner NX EX ttl`, 해제는 owner 비교 Lua를 사용합니다.
- Redis URL/token 미설정, HTTP URL, provider 오류를 fail-closed로 처리합니다.
- 유료 상품은 fetch 전 차단하고 `orderAccessToken != free`도 결제 token을 반환하지 않고 거부합니다.
- 모든 계정이 eligible일 때 purchase 호출 순서가 계정 1→2→3으로 유지됩니다.
- success, already_claimed, duplicate, ineligible, failed, uncertain을 구분합니다.
- post-purchase 확인 실패는 `uncertain` ledger로 기록됩니다.
- purchase 후 ledger 저장 실패 시 장기 account lock이 유지되어 자동 재시도를 막습니다.
- same-origin, 유효 session, session별 CSRF token, Redis readiness 전에는 DomiNations 요청을 시작하지 않습니다.
- UI는 사용자 confirm 이후에만 POST하고 결과 미확정 시 재클릭 금지 안내를 표시합니다.
- 공개 응답에서 full gameAccountId, SKU, offer, bearer, cookie, Redis token을 제거합니다.

## 미완료 검증

| 검증 | 상태 | 필요한 조치 |
| --- | --- | --- |
| Upstash 운영 atomic lock | 대기 | Vercel project에 Marketplace integration 연결 |
| 실상품 exact field | 대기 | Google 로그인 후 3계정 product 조회 |
| 실제 `orderAccessToken=free` | 대기 | 작업지시자가 dashboard 버튼으로 최초 실행 |
| 수령 후 stock/cooldown | 대기 | 최초 실행 결과와 product 재조회 확인 |
| 동일 cycle 재클릭 | 대기 | 최초 실행 후 duplicate ledger 확인 |

실제 DomiNations 상태 변경 요청은 전송하지 않았습니다. 테스트의 purchase 요청은 전부 메모리 mock이었습니다.
