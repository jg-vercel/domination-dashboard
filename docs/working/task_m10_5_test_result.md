# 테스트 결과: M1.0 Issue #5 release 검증

## 상태

- 상태: release 및 Vercel Preview 인프라 검증 완료, Google OAuth·실계정 검증 대기
- 작성자: Codex
- 범위: 감사 기록, 재시도 UX, 전체 애플리케이션 release 품질·보안 검사

## 기준 문서

- 수행계획서: `docs/plans/task_m10_5.md`
- 구현계획서: `docs/plans/task_m10_5_impl.md`
- 배포 체크리스트: `docs/working/task_m10_5_deploy_checklist.md`
- 테스트 전략: `docs/manual/test-strategy.md`

## 실행 환경

- 브랜치: `local/task5`
- 실행일: 2026-08-28
- release runtime: Node.js `24.20.0`
- package manager: pnpm `11.24.0`
- Vercel CLI metadata 확인: `59.9.1`
- Vercel 실행일: 2026-08-31
- Vercel runtime: Node.js `24.18.0`, Function `iad1`

## release 실행 결과

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `pnpm lint` | 통과 | ESLint 오류 없음 |
| `pnpm typecheck` | 통과 | TypeScript 오류 없음 |
| `pnpm test` | 통과 | 13 files, 49 tests |
| `pnpm test:integration` | 통과 | 3 files, 12 tests |
| `pnpm build` | 통과 | dashboard, 인증 3개, claim 2개, system 3개 Route Handler |
| `pnpm audit --prod` | 통과 | 알려진 production 취약점 0 |
| tracked secret pattern scan | 통과 | OAuth/Redis key/private key pattern 없음 |
| `git ls-files '.env*'` | 통과 | `.env.example`만 추적 |
| `git check-ignore -v .env.local` | 통과 | `.gitignore`의 `.env*` 규칙 적용 |
| `vercel whoami` | 통과 | `mintmd95-4401` |
| `vercel deploy --yes` | 통과 | 최종 Preview `dpl_99RgeYD5GAJ7wMVq8ohCNFD42uwV`, Ready |
| Vercel remote build | 통과 | Washington, D.C. `iad1`, Next.js build 성공 |
| Upstash REST `PING` | 통과 | Preview Free resource에서 `PONG` |

## 기능 검증

- Redis audit pipeline이 `LPUSH`, 최근 50개 `LTRIM`, 30일 `EXPIRE`를 사용합니다.
- admin subject는 hash key로만 사용하고 audit JSON에는 저장하지 않습니다.
- 손상되거나 허용되지 않은 audit record는 dashboard/API에서 제거됩니다.
- 최근 실행은 cycle, summary, account name, 마스킹 ID, 상태·reason만 표시합니다.
- 최신 audit이 있으면 버튼이 “실패·미수령 계정 다시 확인”으로 바뀝니다.
- success/already/uncertain은 ledger로 skip되고 failed/ineligible만 최신 상품을 재조회합니다.
- 실행 중 버튼 disabled, user confirm, 결과·감사 저장 실패 경고가 표시됩니다.
- 다음 reset 날짜와 `09:00` KST가 dashboard에 표시됩니다.

## 로컬 HTTP 확인

| 경로 | 결과 |
| --- | --- |
| `/` | Google 설정 필요, 계정 3개, 수령 버튼, 최근 기록 빈 상태, 09:00 표시 |
| `POST /api/claims/free-legendary-token` (환경 미설정) | `503 CLAIM_NOT_CONFIGURED`, `no-store` |
| `GET /api/claims/audit` (환경 미설정) | `503 CLAIM_NOT_CONFIGURED`, `no-store` |

조작 가능한 앱 브라우저가 현재 세션에 없어 시각 screenshot 회귀 테스트는 실행하지 못했습니다. HTML 의미 구조, 반응형 CSS, React Testing Library UI 테스트와 production build로 배포 전 검증을 완료했습니다.

## Vercel Preview 검증

| 검증 | 결과 |
| --- | --- |
| 고정 별칭 | `https://domination-dashboard-preview.vercel.app` |
| Deployment target | `preview` |
| Deployment protection | Vercel Authentication 302 보호, 인증 요청으로 내부 검증 |
| `/api/health` | `200`, `no-store` |
| `/api/system/region` | `iad1`, Vercel, region 일치 |
| `/api/system/outbound-country` | `US`, `asia=false`, `targetMet=true` |
| `/api/auth/google/start` | Google 변수 미설정 상태에서 `503 AUTH_NOT_CONFIGURED`, `no-store` |
| Upstash | `iad1`, Free, Preview 전용, auto-upgrade 비활성, `PING -> PONG` |

Vercel CLI `59.9.1`은 project의 첫 `vercel deploy --yes`를 명령의 `--prod` 부재와 관계없이 Production target으로 자동 지정했습니다. 최초 deployment `dpl_vxs3cSF2s6XBTKmKA9W3vsZohCFc`에는 환경 변수가 없고 인증 경로가 503으로 닫힌 것을 확인했습니다. 이어서 실제 Preview deployment를 별도로 만들었으며, Production 추가 설정이나 재배포는 수행하지 않았습니다.

## 남은 실계정 검증

- `iad1`, `US`, `asia=false`
- Google 실 OAuth와 관리자 allowlist
- DomiNations session 크기와 계정 3개
- exact 상품·무료·SKU·offer·stock
- 최초 사용자 버튼 수령, 결과 audit, 동일 cycle duplicate

위 검증은 작업지시자 소유 Google OAuth Web client 3개 값과 브라우저 상호작용이 필요합니다. 이 문서 작성 시점에는 Vercel Preview 인프라 배포는 완료했지만 DomiNations 계정 로그인과 상태 변경은 수행하지 않았습니다.
