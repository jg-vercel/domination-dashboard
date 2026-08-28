# 테스트 결과: M1.0 Issue #2 대시보드 기반 및 미국 리전 PoC

## 상태

- 상태: 로컬 검증 승인 완료, Vercel Preview 검증 대기
- 작성자: Codex
- 범위: Next.js 기반, 시스템 진단 Route Handler, `iad1` 설정

## 기준 문서

- 수행계획서: `docs/plans/task_m10_2.md`
- 구현계획서: `docs/plans/task_m10_2_impl.md`
- 테스트 전략: `docs/manual/test-strategy.md`

## 실행 환경

- 브랜치: `local/task2`
- 실행일: 2026-08-28
- 배포 호환 검증: Node.js `24.20.0`, pnpm `11.24.0`
- 추가 로컬 HTTP 확인: Node.js `25.9.0`

## 실행 결과

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `pnpm peers check` | 통과 | peer dependency 문제 없음 |
| `pnpm lint` | 통과 | ESLint 오류 없음 |
| `pnpm typecheck` | 통과 | TypeScript 오류 없음 |
| `pnpm test` | 통과 | 2 files, 8 tests |
| `pnpm test:integration` | 통과 | 1 file, 4 tests |
| `pnpm build` | 통과 | 정적 `/`와 동적 Route Handler 3개 생성 |
| 로컬 `/api/health` | `200` | `Cache-Control: no-store` |
| 로컬 `/api/system/region` | `200` | `configuredRegion=iad1`, `runtimeRegion=local` |
| 로컬 `/api/system/outbound-country` | `200` | `KR`, `asia=true`, `apiEnabled=true` |
| 로컬 `/` HTML 확인 | 통과 | 대상 아이템, 계정 3개, 진단·수령 버튼 문구 존재 |

## 해석

- 로컬 환경은 개발자 네트워크를 사용하므로 `KR`, `asia=true`가 정상입니다.
- Route Handler가 외부 공개 국가 판정 endpoint를 브라우저가 아닌 서버에서 호출하는 것을 확인했습니다.
- 미국 네트워크 성공 기준은 Vercel Preview에서 `runtimeRegion=iad1`, `countryCode=US`, `asia=false`, `targetMet=true`로 확인해야 합니다.
- 진단 API는 allowlist 필드만 반환하며 오류 응답에 upstream body를 포함하지 않습니다.

## 미완료 검증

| 검증 | 상태 | 필요한 조치 |
| --- | --- | --- |
| Vercel Function 실제 리전 | 대기 | Preview 배포 후 `/api/system/region` 확인 |
| Vercel outbound 미국 판정 | 대기 | Preview 배포 후 `/api/system/outbound-country` 확인 |

실제 Vercel 배포는 작업지시자의 별도 승인이 필요하므로 이 문서 작성 시점에는 수행하지 않았습니다.
