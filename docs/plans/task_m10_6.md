# 수행계획서: M1.0 Issue #6 Google 장기 로그인과 서버 세션 전환

> 상태: **승인 완료** (2026-08-31)

## 상태

- 상태: 구현·release 검증 및 Google OAuth Preview 재배포 완료, 실계정 검증 대기
- 작성자: Codex
- 범위: 로그인한 Google 계정을 DomiNations 연결 주체로 사용하고 refresh token 기반 장기 session 제공

## 기준 문서

- 이슈: [GitHub Issue #6](https://github.com/jg-vercel/domination-dashboard/issues/6)
- 할일: `docs/orders/20260831.md`
- Preview: `docs/working/preview_long_lived_google_session.md`
- 기존 인증 설계: `docs/tech/task_m10_3_auth_session_design.md`

## 목적

사용자가 Vercel 대시보드에서 Google 계정을 한 번 선택하면 해당 계정에 연결된 DomiNations 게임 계정 3개를 조회·수령할 수 있게 하고, upstream token을 브라우저에 보관하지 않으면서 로그인 상태를 가능한 오래 유지합니다.

## 수행 범위

### 포함

- `ADMIN_GOOGLE_EMAIL` 제거와 검증된 Google subject 기반 session 분리
- Google offline authorization code와 refresh token 필수 처리
- Upstash Redis의 암호화 server-side session
- 180일 idle rolling TTL과 장기 HttpOnly pointer cookie
- Google access token 갱신과 DomiNations credential 재연결
- logout·refresh 거부·Redis 장애의 fail-closed 처리
- 기존 3계정 검증, 무료 상품 제한, idempotency·audit 유지
- 자동 테스트와 운영 문서 갱신

### 제외

- OAuth Client ID/Secret 없는 Google Web OAuth
- Google 비밀번호 또는 raw token의 browser·log 저장
- CAPTCHA·추가 인증·지역 정책 우회
- 실제 item 수령과 Production 재배포

## 단계

1. 기존 cookie session을 opaque cookie + Redis sealed payload 구조로 분리합니다.
2. Google authorization을 offline access로 변경하고 refresh token 교환을 구현합니다.
3. session 생성·조회·rolling 연장·삭제와 Domi credential 재연결을 구현합니다.
4. dashboard, audit, claim, logout 경로를 async server session resolver로 전환합니다.
5. mock 외부 요청과 Redis adapter를 단위·통합 테스트합니다.
6. 전체 release 검증과 문서 갱신 후 승인된 Preview에 재배포하고 미국 리전·fail-closed 동작을 검증합니다.

## 위험 및 대응

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| refresh token 미발급 | 장기 로그인 불가 | `prompt=consent`, `access_type=offline`, token 누락 시 session 발급 거부 |
| refresh token 취소·만료 | dashboard/claim 실패 | server session 삭제 후 명확한 재로그인 안내 |
| Redis 장애 | session 조회 불가 | token을 cookie로 fallback하지 않고 503 fail-closed |
| session 탈취 | 계정 접근 | 256-bit opaque ID, HttpOnly/Secure/SameSite cookie, Redis key hash, value AES-GCM |
| Domi credential 만료 | 조회·수령 실패 | claim 전 강제 재연결, dashboard 401 시 1회 재연결 |
| refresh 폭주 | Google/Xsolla 제한 | 재연결 시각 저장, dashboard cache interval, claim 전 제한적 강제 갱신 |

## 완료 기준

- fixed admin email 없이 Google subject별 session이 분리됩니다.
- refresh token과 Domi credential이 Redis sealed payload에만 존재합니다.
- cookie에는 upstream token이 없고 180일 idle TTL이 활동 시 연장됩니다.
- logout과 refresh 거부 후 기존 cookie로 session을 복원할 수 없습니다.
- 기존 3계정·무료 상품·중복 방지 테스트가 모두 유지됩니다.
- lint, typecheck, unit, integration, build, production audit가 통과합니다.

## 승인

- 승인자: 작업지시자
- 승인일: 2026-08-31
- 승인 범위: 계획서 갱신, 소스 구현, 테스트, 문서 갱신
