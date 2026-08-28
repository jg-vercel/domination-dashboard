# 구현계획서: M1.0 Issue #2 대시보드 기반 및 미국 리전 PoC

> 상태: **승인 완료** (2026-08-28)

## 상태

- 상태: 구현·로컬 검증 완료, 배포 검증 대기
- 작성자: Codex
- 범위: Issue #2 소스·설정·테스트 구현

## 기준 문서

- 이슈: [GitHub Issue #2](https://github.com/jg-vercel/domination-dashboard/issues/2)
- 할일: `docs/orders/20260828.md`
- 수행계획서: `docs/plans/task_m10_2.md`

## 구현 접근

App Router의 페이지는 정적 대시보드 기반으로 만들고, 네트워크 진단은 Node.js Route Handler로 격리합니다. `vercel.json`의 프로젝트 기본 리전을 `iad1`으로 고정합니다. 외부 국가 판정은 DomiNations 공개 `getplayercountry` 요청을 서버에서만 수행하며 5초 timeout, `no-store`, 명시적 응답 schema를 적용합니다.

## 변경 대상

- 프로젝트 설정: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `vercel.json`
- 애플리케이션: `src/app/`, `src/components/`, `src/lib/system/`
- 테스트: `src/**/*.test.ts`, `src/**/*.test.tsx`, `tests/integration/`
- 환경·운영 문서: `.env.example`, `README.md`, `docs/working/task_m10_2_test_result.md`

## API 경계

| 경로 | 방식 | 역할 | 상태 변경 |
| --- | --- | --- | --- |
| `/api/health` | `GET` | 프로세스 기본 상태 | 없음 |
| `/api/system/region` | `GET` | Vercel region, 목표 region, Node major 공개 | 없음 |
| `/api/system/outbound-country` | `GET` | 서버 outbound 기준 DomiNations 공개 국가 판정 | 없음 |

## 보안 기준

- 모든 진단 응답에 `Cache-Control: no-store`를 적용합니다.
- 환경 변수 전체, request header, cookie, token은 응답·로그에 넣지 않습니다.
- 브라우저에서 DomiNations endpoint를 직접 호출하지 않습니다.
- 외부 응답은 허용된 필드와 타입만 정규화합니다.

## 검증 방법

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration`
- `pnpm build`
- 로컬 서버에서 세 Route Handler HTTP 응답 확인
- 배포 후 `runtimeRegion=iad1`, `countryCode=US`, `asia=false` 확인

## 롤백 기준

- 외부 endpoint가 상태 변경을 유발하거나 인증값을 요구하면 해당 진단을 제거합니다.
- 진단 응답에서 민감 정보가 발견되면 endpoint를 비활성화하고 allowlist를 재검토합니다.
- Vercel 설정 schema 또는 Next.js build가 실패하면 배포 요청을 중단합니다.

## 승인

- 소스 수정 승인자: 작업지시자
- 승인일: 2026-08-28
- 승인 범위: Vercel 실제 배포 직전까지 전 과정 자동 승인
