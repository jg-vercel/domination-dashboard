# Google 로그인 장기 세션 전환 Preview

> 상태: **승인 완료** (2026-08-31)

## 상태

- 상태: 승인됨
- 작성자: Codex
- 작성일: 2026-08-31
- 우선순위: P0
- 범위: Google 로그인 계정 자체를 DomiNations 연결 주체로 사용하고, 서버 저장 refresh token으로 로그인 상태를 장기간 유지

## 요청 배경

작업지시자는 `Vercel 대시보드 접속 -> Google 로그인 -> 로그인한 Google 계정에 연결된 게임 계정 3개 조회 -> 사용자가 버튼으로 무료 아이템 수령` 흐름을 요청했습니다. 고정 관리자 이메일 입력은 제거하고 실제 Google 로그인 계정이 각자 자신의 DomiNations 연결과 감사 기록의 소유자가 되도록 합니다.

현재 구현은 Google Authorization Code + PKCE를 사용하지만 `access_type=online`이며, DomiNations credential을 12시간 암호화 cookie에 보관합니다. 이 구조는 12시간 뒤 재로그인이 필요하고 refresh token을 사용하지 않습니다.

## 승인 범위

### 포함

- 고정 `ADMIN_GOOGLE_EMAIL` 환경 변수와 이메일 allowlist 제거
- Google OAuth `access_type=offline` 및 refresh token 필수 수신
- Google identity 검증 후 로그인한 subject를 session 소유자로 사용
- refresh token과 DomiNations credential을 Upstash Redis에 암호화 저장
- 브라우저에는 opaque HttpOnly session cookie만 저장
- 180일 rolling session과 활동 시 TTL 연장
- Google access token 갱신 및 DomiNations credential의 제한된 자동 재연결
- 로그아웃 시 Redis session 삭제와 cookie 폐기
- refresh token 만료·취소·상류 인증 거부 시 fail-closed 재로그인 안내
- raw Google/DomiNations token의 client·log·Git 비노출
- 단위·통합·release 테스트와 한국어 문서 갱신

### 제외

- Google OAuth Client ID/Secret 등록 생략 또는 타 서비스의 client credential 재사용
- Google 비밀번호 수집·저장
- CAPTCHA, 추가 본인 확인, 계정 또는 지역 통제 우회
- 사용자 조작 없는 예약 수령
- 유료 상품 또는 checkout 처리
- Production 재배포

## 목표 사용자 흐름

1. 사용자가 Vercel 대시보드의 `Google로 연결` 버튼을 누릅니다.
2. Google이 계정 선택과 최초 offline access 동의를 처리합니다.
3. callback은 ID token을 검증하고 Google refresh token을 서버 저장소에 암호화합니다.
4. Google access token을 Xsolla/DomiNations session으로 교환하고 연결된 게임 계정 3개를 검증합니다.
5. 브라우저에는 token이 없는 opaque HttpOnly session cookie만 설정합니다.
6. 이후 대시보드 접속 시 서버 session을 읽고 필요할 때 Google access token과 DomiNations credential을 갱신합니다.
7. 사용자가 로그아웃하거나 refresh token이 거부되면 서버 session과 cookie를 폐기합니다.

## 세션 결정

- session 최대 유휴 기간은 180일로 두고 정상 요청 시 만료를 다시 180일로 연장합니다.
- 장기 유지가 Google refresh token의 영구 유효성을 보장하지는 않습니다. 사용자 권한 취소, token 정책, 계정 보안 변경 또는 장기 미사용 시 재로그인이 필요합니다.
- Redis key에는 무작위 session ID의 hash만 사용합니다.
- Redis value는 `APP_SESSION_SECRET` 기반 AES-256-GCM sealed payload로 저장합니다.
- DomiNations credential은 짧은 refresh 간격을 적용하고 claim 실행 전에 유효한 credential을 확보합니다.
- session 갱신 실패 시 무료 수령 요청을 보내지 않습니다.

## Google 필수 조건

Google Web Server OAuth는 등록된 Client ID와 정확히 일치하는 redirect URI가 필요합니다. 장기 access token 갱신에는 `access_type=offline`으로 받은 refresh token을 안전한 서버 저장소에 보관해야 합니다.

- [Google OAuth Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OAuth 2.0 개요와 refresh token 만료 조건](https://developers.google.com/identity/protocols/oauth2)

## 수용 기준

- `ADMIN_GOOGLE_EMAIL` 없이 검증된 Google 계정으로 로그인할 수 있습니다.
- callback이 refresh token을 받지 못하면 장기 session을 만들지 않습니다.
- 브라우저 cookie와 API payload에 raw upstream token이 포함되지 않습니다.
- Redis 장애 시 인증과 claim이 fail-closed입니다.
- 정상 활동 중 session TTL이 180일로 연장됩니다.
- DomiNations credential 갱신 후에도 동일 Google subject와 게임 계정 3개만 사용합니다.
- 로그아웃 시 동일 session을 다시 사용할 수 없습니다.
- refresh token 거부 시 session을 삭제하고 재로그인을 안내합니다.
- 기존 지역·무료 상품·idempotency·감사 로그 보안 조건이 유지됩니다.

## 승인 이력

| 구분 | 승인 일자 | 승인 내용 |
| --- | --- | --- |
| Preview 및 소스 수정 | 2026-08-31 | 고정 이메일 제거, offline OAuth, Upstash 장기 session, 자동 재연결, 구현·테스트 |
