# 수행계획서: M1.0 Issue #3 Google 로그인과 게임 계정 조회

> 상태: **승인 완료** (2026-08-28)

## 상태

- 상태: 구현·mock 검증 완료, 실계정 검증 대기
- 작성자: Codex
- 범위: 관리자 OAuth, DomiNations session, 계정 3개와 무료 아이템 상태 조회

## 기준 문서

- 이슈: [GitHub Issue #3](https://github.com/jg-vercel/domination-dashboard/issues/3)
- 할일: `docs/orders/20260828.md`
- Preview: `docs/working/preview_us_web_store_purchase.md`
- 조사: `docs/tech/task_m10_1_integration_research.md`

## 목적

Google 비밀번호를 받지 않고 단일 관리자만 로그인하도록 제한하며, Google access token을 서버에서 즉시 Xsolla/DomiNations session으로 교환해 연결된 게임 계정 3개의 무료 토큰 상태를 표시합니다.

## 수행 범위

### 포함

- Google Authorization Code + PKCE, state, nonce
- Google ID token 서명·issuer·audience·expiry·nonce 검증
- `ADMIN_GOOGLE_EMAIL` 단일 관리자 allowlist
- Google access token의 Xsolla 공식 `login_with_token` 교환
- 공개 Web Store와 동일한 DomiNations PKCE token 교환
- AES-256-GCM HttpOnly session과 만료·로그아웃
- `gameAccountId` 기준 계정 3개 검증 및 계정별 상품 상태 조회

### 제외

- Google 비밀번호 또는 raw token의 브라우저 반환·로그 기록
- refresh token을 이용한 무인 인증 연장
- 실제 상품 수령 요청
- 인증 통제·지역·CAPTCHA 우회
- 실제 OAuth/실계정 검증과 Vercel 배포

## 단계

1. 공식 Google OIDC와 Xsolla token 교환 규격, DomiNations 공개 client 요청을 설계 문서에 고정합니다.
2. 환경 설정, 암호화 cookie, Google OAuth adapter를 구현합니다.
3. Xsolla와 DomiNations token·cookie 교환 adapter를 구현합니다.
4. 계정·상품 응답을 allowlist schema로 정규화합니다.
5. 로그인 상태에 따라 대시보드 계정·상품 상태를 렌더링합니다.
6. 외부 요청은 mock으로 검증하고 실제 계정 검증 절차를 분리합니다.

## 산출물

- `docs/tech/task_m10_3_auth_session_design.md`
- Google OAuth Route Handler와 server-only 인증 모듈
- DomiNations account/product adapter
- 로그인·계정 상태 대시보드 UI
- `docs/working/task_m10_3_test_result.md`

## 위험 및 대응

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| 자체 Google OAuth token을 Xsolla project가 거부 | 연동 불가 | 명확한 재로그인 오류로 중단하고 공식 Web Store 이동 대안 유지 |
| 암호화 session이 cookie 제한 초과 | 로그인 실패 | 3.5KB 상한에서 안전하게 거부하고 향후 외부 session store 전환 |
| DomiNations 공개 요청 schema 변경 | 계정 상태 오판 | 엄격한 allowlist 정규화와 fail-closed 적용 |
| 계정이 3개가 아니거나 ID 중복 | 잘못된 수령 대상 | dashboard를 불완전 상태로 표시하고 수령 기능 차단 |
| token 만료 | API 401 | session을 만료 상태로 전환하고 Google 재로그인 안내 |

## 완료 기준

- OAuth 보안 조건과 관리자 allowlist 자동 테스트가 통과합니다.
- raw credential이 client payload 및 로그에 포함되지 않습니다.
- mock session에서 서로 다른 게임 계정 3개와 item 상태가 표시됩니다.
- 실제 OAuth credentials와 실계정이 필요한 검증은 실행 절차와 기대값이 기록됩니다.

## 승인

- 승인자: 작업지시자
- 승인일: 2026-08-28
- 승인 범위: Vercel 실제 배포 직전까지 전 과정 자동 승인
