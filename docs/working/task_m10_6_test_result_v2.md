# 테스트 결과: Google 로그인 유지 후속 보완

## 상태

- 상태: 로컬 검증·운영 HTTP 검증 완료, Google redirect URI 미등록으로 실계정 검증 대기
- 작성자: Codex
- 작성일: 2026-09-14
- 계획서: `docs/plans/task_m10_6_v2.md`, `docs/plans/task_m10_6_impl_v2.md`
- 브랜치: `local/task6`
- 기준 커밋: `26e237d` + 이번 작업의 미커밋 변경
- 실행 환경: macOS, Node v24.21.0, pnpm 11.24.0
- 기본 shell은 Node v25.9.0이며 pnpm이 없어 `npx --yes --package=node@24 --package=pnpm@11.24.0 -c '명령'`으로 프로젝트 요구 버전을 사용했습니다.

## 실행 결과

| 명령/검증 | 결과 | 비고 |
| --- | --- | --- |
| `pnpm test` | 통과 | 26 files, 678 tests |
| `pnpm test:integration` | 통과 | 7 files, 63 tests |
| `pnpm lint` | 최종 통과 | 최초 새로고침 anchor lint 오류를 GET form으로 수정 후 재실행 |
| `pnpm typecheck` | 통과 | TypeScript 오류 없음 |
| `pnpm build` | 통과 | 마지막 UI·CSS 변경 후 다시 빌드, 빌드 내부 TypeScript 검사 포함 |
| `pnpm exec vitest run src/components/auth-control.test.tsx` | 통과 | GET form 수정 후 관련 6개 회귀 테스트 재실행 |
| `git diff --check` | 통과 | 공백 오류 없음 |
| 로컬 `GET /` | 200 | 새 설정 안내 존재, 기존 `.env.local 확인` 문구 없음 |
| 로컬 `GET /api/auth/google/start` | 503 | 설정 없는 환경에서 `AUTH_NOT_CONFIGURED` 유지 |
| 운영 `GET /api/auth/google/start` | 503 | 현재 배포본의 `AUTH_NOT_CONFIGURED` 확인 |
| Preview `GET /api/auth/google/start` | 302 | `vercel.com`으로 리다이렉트, 보호된 화면 너머 OAuth 동작은 미검증 |
| Browser 시각 검증 | 미실시 | 연결 가능한 브라우저 없음, discovery 결과 `[]` |

## 의미 있는 회귀 시나리오

- OAuth 누락/Redis 누락/둘 다 누락/미로그인/로그인 완료/일시 장애 상태를 구분합니다.
- 로그인 없는 상태에서는 keepalive 요청을 보내지 않습니다.
- 표시 중 1시간 간격으로 갱신하고 숨겨진 탭은 건너뜁니다. 탭 복귀 시 갱신하되 짧은 간격의 이벤트는 제한합니다.
- 네트워크 오류와 503은 로그아웃으로 전환하지 않고 다음 주기에 재시도합니다.
- 401은 UI 새로고침을 한 번 요청하고 해당 effect의 추가 갱신을 중단합니다.
- 진행 중 요청을 중첩하지 않고, unmount 후 타이머·이벤트·늦은 응답의 UI 갱신을 차단합니다.
- API 성공은 400일 `Secure; HttpOnly; SameSite=lax` cookie를 설정하며 응답 본문에 토큰을 반환하지 않습니다.
- API의 확정된 세션 만료·무효 응답은 cookie를 삭제합니다. 저장소 장애·설정 누락에서는 삭제하지 않습니다.
- 가상 시각으로 최초 로그인 179일 후 재접속하고 358일째 다시 접속해 동일 세션이 538일째까지 연장됨을 확인했습니다.
- 180일을 초과해 활동하지 않은 세션은 거부됩니다. 이 테스트는 실제 수개월 실사용 관찰을 대체하지 않습니다.

## 검증 범위의 한계

실제 Redis·Google 계정으로 토큰 갱신, 브라우저 종료 후 복원, 운영 도메인에서의 장기 유지, 실제 게임 연결·수령은 검증하지 않았습니다. 서버 저장소 테스트는 메모리 대역과 가상 시각, Route Handler는 세션 해석 대역을 사용합니다. 실제 설정값·토큰·cookie를 수집하거나 출력하지 않았습니다.

## 운영 배포 후 추가 검증 (2026-09-14)

위 실행 표의 운영 503은 배포 전 결과입니다. 작업지시자 “반영해” 승인 후 운영 설정과 배포를 적용한 결과는 다음과 같습니다.

- 코드: `b118e39`, 원격 `devel`
- 배포: `dpl_6nhBpxAXhJUZKT54zPqdtSra3so7`, Production `READY`
- Vercel 원격 build와 TypeScript 검사 통과, runtime Node v24.19.0
- 운영 `/`: 200, 로그인 링크 있음, `.env.local 확인` 및 설정 준비 경고 없음
- 운영 `/api/health`: 200
- 운영 `/api/system/region`: `iad1`, `regionMatches=true`
- 운영 `/api/system/outbound-country`: US, `asia=false`, `targetMet=true`
- 운영 `/api/auth/session` (미로그인, same-origin POST): 401 `AUTH_REQUIRED`
- 운영 `/api/auth/google/start`: 307, Google로 이동, `access_type=offline`, callback은 운영 도메인과 일치
- OAuth flow cookie: HttpOnly·Secure 확인, 값은 출력하지 않음
- Google 인증 페이지: 200의 OAuth error 화면에서 `redirect_uri_mismatch` 확인, `invalid_client`는 없음
- Google Cloud Console에서 운영 callback을 등록해야 실제 로그인을 검증할 수 있습니다. Browser 재연결 시도도 `No browser is available`로 실패했습니다.
