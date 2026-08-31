# 구현계획서: M1.0 Issue #6 Google 장기 로그인과 서버 세션 전환

> 상태: **승인 완료** (2026-08-31)

## 상태

- 상태: upstream 인증 단계 진단 패치 release 검증 완료, Preview 재배포 진행중
- 작성자: Codex
- 범위: 인증 config·Google adapter·Redis session store·Route Handler·dashboard 전환

## 기준 문서

- 이슈: [GitHub Issue #6](https://github.com/jg-vercel/domination-dashboard/issues/6)
- 수행계획서: `docs/plans/task_m10_6.md`
- Preview: `docs/working/preview_long_lived_google_session.md`

## 구현 접근

OAuth flow cookie는 기존의 10분 PKCE/state/nonce sealed cookie를 유지합니다. callback은 offline authorization code를 교환하면서 검증된 ID token, access token, refresh token을 받고, access token으로 DomiNations credential과 고유 게임 계정 3개를 검증합니다.

장기 session은 256-bit 무작위 session ID를 가진 opaque cookie와 Redis value로 분리합니다. Redis key에는 session ID의 SHA-256 hash만 넣고, value에는 Google identity, refresh token, DomiNations credential, CSRF token, 갱신 시각을 `APP_SESSION_SECRET`으로 AES-256-GCM 봉인해 저장합니다. Redis session은 정상 조회마다 180일 idle TTL을 연장합니다.

dashboard는 저장 credential로 조회하다 `SESSION_EXPIRED`가 발생하면 Google access token refresh와 DomiNations 재연결을 한 번 수행합니다. claim route는 상품 상태 변경 전에 credential을 갱신해 expired session으로 수령 요청을 시작하지 않습니다. logout은 Redis record 삭제를 시도한 뒤 결과와 관계없이 cookie를 제거합니다.

## 변경 대상

- 환경·인증: `.env.example`, `src/lib/auth/config.ts`, `google.ts`, `session.ts`, 신규 server session module
- Redis: `src/lib/idempotency/redis-rest.ts`
- 경로: Google callback, logout, dashboard page, claim·audit Route Handler
- UI·문서: 인증 안내 문구, README, working 문서
- 테스트: auth/Redis 단위 테스트와 auth·claim 통합 테스트
- 진단 패치: Xsolla Google token, DomiNations signup, DomiNations token 거부 코드를 분리하고 stage·HTTP status만 기록

## 보안 불변조건

- Google refresh token과 DomiNations credential은 client component·response JSON·log에 포함하지 않습니다.
- upstream 진단 로그에는 stage와 HTTP status만 포함하고 token, cookie, Google identity, response body를 포함하지 않습니다.
- Redis value는 평문 token을 저장하지 않습니다.
- session cookie에는 upstream token 또는 Google email을 저장하지 않습니다.
- refresh token 누락·거부, Redis 장애, account 3개 검증 실패 시 session을 발급하거나 claim하지 않습니다.
- claim의 same-origin, CSRF, 무료 가격, exact 상품, idempotency 조건을 유지합니다.

## 검증 방법

- offline OAuth URL과 refresh token 필수 schema 테스트
- refresh grant 성공·거부·malformed response 테스트
- server session 생성·암호화·key hash·rolling TTL·logout 삭제 테스트
- Domi credential cache·강제 재연결·account count 실패 테스트
- dashboard·audit·claim 인증 통합 테스트
- 기존 전체 단위·통합 테스트 회귀
- lint, typecheck, build, production audit, tracked secret scan

## 롤백 기준

- raw token이 cookie·응답·log에 노출되면 장기 session 경로를 비활성화합니다.
- Redis가 원자적 session 폐기를 보장하지 못하면 기존 12시간 fail-closed session으로 되돌립니다.
- refresh token이 Xsolla/DomiNations 재연결에 사용할 access token을 발급하지 못하면 자동 연장을 중단하고 재로그인 상태로 전환합니다.

## 승인

- 소스 수정 승인자: 작업지시자
- 승인일: 2026-08-31
- 승인 범위: Issue #6 구현·테스트·문서 갱신
- 추가 승인 범위: upstream 인증 단계 진단 패치·테스트·Preview 재배포 (2026-08-31)
