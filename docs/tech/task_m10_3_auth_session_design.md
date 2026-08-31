# Issue #3 인증·session 설계

> 후속 변경: 이 문서의 12시간 cookie session과 관리자 email allowlist는 Issue #6의 `docs/tech/task_m10_6_long_session_design.md`로 대체됐습니다. 아래 내용은 2026-08-28 당시 설계 기록으로 보존합니다.

## 상태

- 상태: 승인 완료
- 작성자: Codex
- 확인일: 2026-08-28

## 인증 흐름

1. `/api/auth/google/start`가 PKCE verifier/challenge, state, nonce를 생성합니다.
2. verifier·state·nonce는 10분짜리 AES-256-GCM HttpOnly cookie에 저장하고 Google Authorization Endpoint로 redirect합니다.
3. callback은 state를 비교하고 code를 Google Token Endpoint에서 교환합니다.
4. Google ID token의 서명, issuer, audience, expiry, nonce, `email_verified`를 검증합니다.
5. 검증된 email이 `ADMIN_GOOGLE_EMAIL`과 정확히 일치하는지 확인합니다.
6. Google access token을 Xsolla Login project의 `/social/google/login_with_token`에 서버에서 전달합니다.
7. 반환된 Xsolla JWT를 DomiNations `/api/accounts/signup`에 공개 client와 같은 PKCE 필드로 전달합니다.
8. `authcode`를 `/api/accounts/token`에서 교환하고 response cookie를 보존합니다.
9. Google access token과 Xsolla JWT는 session에 저장하지 않고 즉시 폐기합니다.
10. DomiNations bearer/cookie와 최소 관리자 profile만 12시간짜리 암호화 HttpOnly cookie에 봉인합니다.

## 확인된 외부 요청

| 목적 | 요청 |
| --- | --- |
| Xsolla social token 교환 | `POST https://login.xsolla.com/api/social/google/login_with_token?projectId=8fa0bdc4-6ab1-47e2-91dc-731b88e3607f&with_logout=0` |
| DomiNations authorization code | `POST https://api.dominationsworld.com/api/accounts/signup` |
| DomiNations bearer 교환 | `POST https://api.dominationsworld.com/api/accounts/token` |
| 연결 game ID 목록 | `POST https://api.dominationsworld.com/api/gameident/dom/list` |
| 연결 계정 정보 | `GET https://api.dominationsworld.com/api/dominations/linked_user_info` |
| 계정별 상품 | `POST https://api.dominationsworld.com/api/xsollastore/getproducts` |

위 요청은 Xsolla 공식 문서와 DomiNations World가 2026-08-28 공개한 Web Store JavaScript에서 확인했습니다. DomiNations API는 별도 공개 계약 문서가 없으므로 schema 불일치·정책 거부 시 우회 없이 중단합니다.

## session cookie

| 항목 | 값 |
| --- | --- |
| 암호화 | AES-256-GCM, `APP_SESSION_SECRET`에서 SHA-256 key 파생 |
| 속성 | `HttpOnly`, `SameSite=Lax`, `Secure`(production), `Path=/` |
| OAuth flow 만료 | 10분 |
| 로그인 session 만료 | 12시간 또는 DomiNations credential 만료 중 이른 값 |
| 상한 | 암호문 3,500 bytes, 초과 시 fail-closed |

refresh token을 저장하거나 무인으로 인증을 연장하지 않습니다. session이 만료되거나 DomiNations API가 401을 반환하면 Google 재로그인을 요구합니다.

## 브라우저 공개 모델

- 관리자: `name`, `email`, 선택적 `picture`
- 계정: `gameAccountId`의 마스킹된 식별자, name, age, trophies
- 상품: exact target 발견 여부, 무료 여부, availability, stock/refresh 상태
- 인증 오류: 내부 payload 없는 안정적인 오류 code와 사용자 안내

raw token, cookie, upstream error body는 공개 모델에 포함하지 않습니다.

## 필수 환경 변수

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ADMIN_GOOGLE_EMAIL`
- `APP_SESSION_SECRET` (최소 32자)
- `APP_BASE_URL` (운영 환경 필수, 예: `https://example.vercel.app`)

로컬 Google OAuth redirect URI는 `http://localhost:3000/api/auth/google/callback`입니다. 운영 redirect URI는 실제 Vercel URL 확정 후 Google Cloud에 별도로 등록합니다.

## 미확인 항목

- 사용자의 Google access token을 현재 Xsolla Login project가 실제로 수락하는지
- DomiNations session 암호문이 3,500 bytes 안에 들어오는지
- 실계정에서 고유 게임 계정 3개와 exact item이 반환되는지

미확인 항목은 mock 테스트로 성공을 단정하지 않으며 실제 사용자 OAuth 검증 전까지 수령 기능을 차단합니다.
