# 테스트 결과: M1.0 Issue #3 Google 로그인과 게임 계정 조회

## 상태

- 상태: 로컬·mock 검증 승인 완료, 실계정 OAuth 검증 대기
- 작성자: Codex
- 범위: Google OAuth, 암호화 session, Xsolla/DomiNations adapter, 계정·상품 snapshot

## 기준 문서

- 수행계획서: `docs/plans/task_m10_3.md`
- 구현계획서: `docs/plans/task_m10_3_impl.md`
- 인증 설계: `docs/tech/task_m10_3_auth_session_design.md`

## 실행 환경

- 브랜치: `local/task3`
- 실행일: 2026-08-28
- 배포 호환 검증: Node.js `24.20.0`, pnpm `11.24.0`

## 실행 결과

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `pnpm lint` | 통과 | ESLint 오류 없음 |
| `pnpm typecheck` | 통과 | TypeScript 오류 없음 |
| `pnpm test` | 통과 | 7 files, 23 tests |
| `pnpm test:integration` | 통과 | 2 files, 7 tests |
| `pnpm build` | 통과 | 동적 대시보드와 인증 Route Handler 3개 포함 |
| 구성 전 `/` | 통과 | OAuth 설정 필요·수령 차단 UI 확인 |
| 구성 전 `/api/auth/google/start` | `503` | `AUTH_NOT_CONFIGURED`, `no-store`, secret 미노출 |

## 검증한 보안 조건

- OAuth 시작 URL이 Authorization Code, PKCE S256, state, nonce를 포함합니다.
- flow cookie는 HttpOnly·SameSite=Lax이며 state와 verifier가 평문으로 노출되지 않습니다.
- 암호화 cookie 변조·만료·3.5KB 초과를 모두 거부합니다.
- 검증된 Google email이 관리자 allowlist와 다르면 DomiNations 요청 전에 거부합니다.
- Xsolla 및 DomiNations PKCE 요청에서 cookie jar가 token 교환 단계로 전달됩니다.
- DomiNations 401은 raw upstream body 없이 `SESSION_EXPIRED`로 변환됩니다.
- dashboard snapshot은 full `gameAccountId`, SKU, offer ID, bearer, cookie를 브라우저 모델에서 제거합니다.
- 계정 원본 두 곳에서 정확히 3개의 고유 ID가 일치하지 않으면 `ACCOUNT_COUNT_MISMATCH`로 차단합니다.
- target item의 exact name, Web Specials tag, 무료, SKU·offer ID, stock 조건을 fail-closed로 정규화합니다.

## 미완료 검증

| 검증 | 상태 | 필요한 조치 |
| --- | --- | --- |
| Google 실 OAuth | 대기 | 작업지시자가 Google Cloud client와 로컬 redirect URI 설정 |
| Xsolla project의 자체 Google token 수락 | 대기 | 브라우저에서 관리자 Google 로그인 1회 |
| DomiNations session cookie 크기 | 대기 | callback 결과가 3.5KB 안인지 실제 확인 |
| 게임 계정 3개 | 대기 | 실 session의 두 account endpoint 결과 확인 |
| 계정별 Free Legendary Token | 대기 | 실 product 목록의 이름·tag·SKU·offer·stock 확인 |

실 OAuth와 계정 상태 변경 요청은 실행하지 않았고 raw credential은 생성·저장·출력하지 않았습니다.
