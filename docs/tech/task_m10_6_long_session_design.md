# Issue #6 Google 장기 session 설계

## 상태

- 상태: 구현·release 검증 완료
- 작성자: Codex
- 확인일: 2026-08-31
- 구현 commit: `754018e`

## 사용자 흐름

1. 사용자가 대시보드에서 Google 로그인 버튼을 누릅니다.
2. `/api/auth/google/start`가 PKCE, state, nonce를 생성하고 Google에 offline access를 요청합니다.
3. Google callback은 authorization code를 access token, ID token, refresh token으로 교환합니다.
4. ID token의 서명·issuer·audience·expiry·nonce·email verification을 확인합니다.
5. 검증된 Google subject를 session 소유자로 사용하고 고정 email allowlist는 적용하지 않습니다.
6. Google access token을 Xsolla와 DomiNations credential로 교환하고 고유 게임 계정 3개를 확인합니다.
7. refresh token과 DomiNations credential을 암호화한 Redis session을 만들고 browser에는 opaque cookie만 설정합니다.

## Google OAuth 결정

| 항목 | 값 |
| --- | --- |
| grant | Authorization Code + PKCE |
| access | `access_type=offline` |
| prompt | `consent select_account` |
| scope | `openid email profile` |
| refresh token | callback에서 필수, 누락 시 session 미발급 |
| access token | DomiNations 연결 또는 갱신에 사용 후 저장하지 않음 |

Google OAuth Web client와 정확히 일치하는 redirect URI는 여전히 필수입니다. refresh token이 취소·만료되면 Redis session을 삭제하고 재로그인을 요구합니다.

## 서버 session 구조

```text
Browser HttpOnly cookie
  -> AES-GCM sealed { sessionId, issuedAt, expiresAt }
  -> SHA-256(sessionId)
  -> Upstash key auth:session:v1:<digest>
  -> AES-GCM sealed server payload
       - Google identity
       - Google refresh token
       - DomiNations bearer/cookies
       - claim CSRF token
       - lastSeenAt / dominationsConnectedAt / expiresAt
```

- session ID는 256-bit CSPRNG 값입니다.
- Redis key에는 원본 session ID가 포함되지 않습니다.
- Redis value는 `APP_SESSION_SECRET` 기반 AES-256-GCM 암호문입니다.
- cookie에는 Google email, refresh token, DomiNations token·cookie가 포함되지 않습니다.
- server payload 상한은 16KB이며 초과 시 fail-closed합니다.

## 만료와 갱신

| 항목 | 값 |
| --- | --- |
| OAuth flow cookie | 10분 |
| Redis idle TTL | 180일, 정상 요청마다 연장 |
| Browser cookie | 400일, 로그인 상태의 dashboard 방문마다 keep-alive로 재설정 |
| DomiNations reconnect interval | 6시간 |
| Claim 전 동작 | Google access token과 DomiNations credential 강제 갱신 후 수령 검증 시작 |

`/api/auth/session`은 same-origin POST와 유효한 HttpOnly cookie를 요구합니다. client keep-alive는 dashboard 방문당 한 번만 요청하고 실패 재시도 loop를 만들지 않습니다.

dashboard 조회 중 DomiNations 401이 발생하면 한 번만 Google refresh와 DomiNations 재연결을 수행합니다. claim은 CSRF 검증 후 upstream 상태 변경 전에 강제 재연결합니다.

## 로그아웃과 오류 처리

- 로그아웃은 Redis `DEL`을 시도한 뒤 browser cookie를 만료시킵니다.
- Google refresh 거부 시 Redis record를 삭제합니다.
- Google/Redis/DomiNations network 장애는 token을 cookie로 fallback하지 않습니다.
- Redis가 없으면 로그인 session 생성·조회와 claim을 503으로 닫습니다.
- CAPTCHA나 추가 본인 확인은 자동 우회하지 않습니다.

## 필수 환경 변수

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APP_SESSION_SECRET` (최소 32자)
- `APP_BASE_URL` (Vercel 필수)
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

`ADMIN_GOOGLE_EMAIL`은 더 이상 사용하지 않습니다.

## 검증 결과

- unit 59개와 integration 13개 통과
- cookie·Redis 암호문에서 raw Google/DomiNations token 문자열 비노출 확인
- Redis key의 원본 session ID 비포함 확인
- 180일 rolling TTL, refresh·reconnect, refresh 거부 삭제, logout 삭제 확인
- lint, typecheck, production build, production dependency audit 통과
