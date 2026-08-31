# 테스트 결과: M1.0 Issue #6 Google 장기 session

## 상태

- 상태: 로컬 구현·release 검증 완료, Preview 재배포 승인 대기
- 작성자: Codex
- 범위: offline Google OAuth, 암호화 server session, rolling TTL, DomiNations 재연결, 기존 claim 회귀

## 기준 문서

- 이슈: [GitHub Issue #6](https://github.com/jg-vercel/domination-dashboard/issues/6)
- 수행계획서: `docs/plans/task_m10_6.md`
- 구현계획서: `docs/plans/task_m10_6_impl.md`
- 기술 설계: `docs/tech/task_m10_6_long_session_design.md`

## 실행 환경

- 브랜치: `local/task6`
- 구현 commit: `754018e`
- 실행일: 2026-08-31
- runtime: Node.js `24.20.0`
- package manager: pnpm `11.24.0`

## 실행 결과

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `pnpm lint` | 통과 | ESLint 오류 없음 |
| `pnpm typecheck` | 통과 | TypeScript 오류 없음 |
| `pnpm test` | 통과 | 15 files, 59 tests |
| `pnpm test:integration` | 통과 | 3 files, 13 tests |
| `pnpm build` | 통과 | dashboard, auth 4개, claim 2개, system 3개 Route Handler |
| `pnpm audit --prod` | 통과 | 알려진 production 취약점 0 |
| credential-shaped secret scan | 통과 | Google key/token/private key pattern 없음 |
| `git ls-files '.env*'` | 통과 | `.env.example`만 추적 |
| `git diff --check` | 통과 | whitespace 오류 없음 |

## 장기 session 검증

- Google authorization URL이 `access_type=offline`, `prompt=consent select_account`, PKCE/state/nonce를 포함합니다.
- callback token response에 refresh token이 없으면 `GOOGLE_REFRESH_TOKEN_MISSING`으로 session을 만들지 않습니다.
- browser cookie에는 random session pointer만 AES-GCM으로 봉인됩니다.
- Redis key는 session ID SHA-256 digest이며 value는 최대 16KB AES-GCM 암호문입니다.
- raw Google refresh token, DomiNations bearer/cookie, Google email이 cookie 또는 Redis 평문에 나타나지 않습니다.
- 정상 session resolve마다 Redis 만료가 180일로 연장됩니다.
- dashboard keep-alive가 same-origin POST로 browser cookie를 400일 재설정합니다.
- 6시간 경과 또는 dashboard 401 시 DomiNations credential을 제한적으로 재연결합니다.
- claim은 CSRF 검증 후 Google access token과 DomiNations credential을 강제로 갱신합니다.
- Google refresh 거부와 logout이 Redis record를 삭제합니다.
- 고정 `ADMIN_GOOGLE_EMAIL` 없이 로그인한 Google subject별로 session과 audit key가 분리됩니다.

## 로컬 HTTP 확인

환경 변수를 의도적으로 비운 production build server에서 확인했습니다.

| 경로 | 결과 |
| --- | --- |
| `GET /` | `200` |
| `GET /api/auth/google/start` | `503 AUTH_NOT_CONFIGURED`, `no-store` |
| `POST /api/auth/session` | `503 AUTH_NOT_CONFIGURED`, `no-store` |
| `POST /api/claims/free-legendary-token` | `503 CLAIM_NOT_CONFIGURED`, `no-store` |

## 미완료 검증

- 실제 Google OAuth Web client의 refresh token 발급
- Google refresh access token을 이용한 Xsolla/DomiNations 재연결
- 실제 Google 계정에 연결된 고유 게임 계정 3개
- Preview에서 로그인 후 cookie/Redis rolling TTL과 logout 삭제
- 실제 `Free Legendary Token` 버튼 수령

위 항목은 Google OAuth client 2개 환경 변수 설정과 Vercel Preview 재배포 승인이 필요합니다. 실제 계정 로그인이나 DomiNations 상태 변경은 수행하지 않았습니다.
