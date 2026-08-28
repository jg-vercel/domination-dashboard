# 구현계획서: M1.0 Issue #3 Google 로그인과 게임 계정 조회

> 상태: **승인 완료** (2026-08-28)

## 상태

- 상태: 구현·mock 검증 완료, 실계정 검증 대기
- 작성자: Codex
- 범위: Issue #3 인증·session·조회 소스와 테스트

## 기준 문서

- 이슈: [GitHub Issue #3](https://github.com/jg-vercel/domination-dashboard/issues/3)
- 수행계획서: `docs/plans/task_m10_3.md`
- 인증 설계: `docs/tech/task_m10_3_auth_session_design.md`

## 구현 접근

OAuth 시작 상태는 10분짜리 암호화 HttpOnly cookie에 PKCE verifier·state·nonce만 저장합니다. callback에서 Google token을 검증하고 관리자 email을 확인한 뒤 access token을 Xsolla와 DomiNations에 즉시 교환합니다. Google·Xsolla raw token은 폐기하고, DomiNations bearer와 cookie만 12시간짜리 AES-GCM session cookie에 봉인합니다.

대시보드 요청 시 session을 복호화해 `/api/gameident/dom/list`, `/api/dominations/linked_user_info`, `/api/xsollastore/getproducts`를 서버에서 호출합니다. 브라우저에는 계정 표시 필드와 정규화된 상품 상태만 전달합니다.

## 변경 대상

- 환경 설정: `.env.example`, `package.json`
- 인증: `src/lib/auth/`, `src/app/api/auth/`
- DomiNations adapter: `src/lib/dominations/`
- dashboard snapshot/API/UI: `src/lib/dashboard/`, `src/app/page.tsx`, `src/components/`
- 테스트: `src/**/*.test.ts`, `tests/integration/`

## 보안 불변조건

- OAuth state·nonce·PKCE verifier 불일치 시 callback을 중단합니다.
- ID token은 Google JWKS로 서명을 검증하고 issuer·audience·expiry·nonce·email_verified를 확인합니다.
- `ADMIN_GOOGLE_EMAIL`과 일치하지 않는 사용자는 DomiNations 요청 전에 거부합니다.
- raw Google/Xsolla/Domi token, cookie, Authorization header를 응답과 로그에 포함하지 않습니다.
- 외부 응답이 예상 schema와 다르면 계정·item을 추정하지 않습니다.

## 검증 방법

- 암호화 round-trip, 변조, 만료, 크기 제한 단위 테스트
- Google OAuth URL·callback token 검증 mock 테스트
- Xsolla/DomiNations PKCE 요청과 cookie 전달 mock 테스트
- 정확히 3개인 고유 `gameAccountId` 및 상품 상태 정규화 테스트
- lint, typecheck, unit, integration, build

## 롤백 기준

- raw credential 노출 가능성이 발견되면 인증 endpoint를 비활성화합니다.
- session 크기가 cookie 상한을 넘으면 credential을 분할하지 않고 외부 server-side store 설계로 전환합니다.
- 공식 API가 자체 OAuth token 또는 요청을 거부하면 우회하지 않고 연동을 차단합니다.

## 승인

- 소스 수정 승인자: 작업지시자
- 승인일: 2026-08-28
- 승인 범위: Vercel 실제 배포 직전까지 전 과정 자동 승인
