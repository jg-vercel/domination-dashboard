# 수행계획서: M1.0 Issue #2 대시보드 기반 및 미국 리전 PoC

> 상태: **승인 완료** (2026-08-28)

## 상태

- 상태: 구현·로컬 검증 완료, 배포 검증 대기
- 작성자: Codex
- 범위: Next.js 애플리케이션 기반, Vercel `iad1`, 실행 리전·outbound 국가 진단

## 기준 문서

- 이슈: [GitHub Issue #2](https://github.com/jg-vercel/domination-dashboard/issues/2)
- 할일: `docs/orders/20260828.md`
- Preview: `docs/working/preview_us_web_store_purchase.md`
- 기술 조사: `docs/tech/task_m10_1_integration_research.md`

## 목적

후속 인증과 수령 기능이 브라우저가 아닌 미국 Vercel Node.js Function에서 실행될 수 있도록 첫 애플리케이션과 검증 가능한 네트워크 경계를 만듭니다.

## 수행 범위

### 포함

- Next.js 16 App Router, TypeScript, pnpm 프로젝트 기반
- Vercel Node.js `24.x`와 단일 `iad1` Function 리전 설정
- 런타임 리전·Node 버전 진단 API
- DomiNations 공개 국가 판정 endpoint를 이용한 읽기 전용 outbound 진단 API
- 진단 상태를 보여주는 대시보드 기반 UI
- 환경 변수·secret 보관 원칙 및 자동 테스트

### 제외

- Google 로그인 및 session 저장
- 게임 계정 조회
- 상품 조회·무료 아이템 수령
- 실제 Vercel 배포

## 단계

1. 승인 스택과 테스트 기준을 문서에 반영합니다.
2. 프로젝트 설정과 App Router 기반 UI를 생성합니다.
3. `iad1` 설정과 서버 전용 진단 모듈·Route Handler를 구현합니다.
4. 성공·오류·timeout을 포함한 테스트를 작성합니다.
5. lint, typecheck, test, build, 로컬 HTTP 확인을 실행합니다.
6. 실제 배포에서만 가능한 검증을 명시하고 배포 직전에 중단합니다.

## 산출물

- Next.js 애플리케이션 소스와 설정
- `docs/tech/project-stack.md`
- `docs/manual/test-strategy.md`
- `docs/plans/task_m10_2_impl.md`
- `docs/working/task_m10_2_test_result.md`

## 위험 및 대응

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| 로컬 Node.js와 Vercel 런타임 차이 | 로컬 성공 후 배포 실패 | `engines.node=24.x`와 CI 성격의 build 검증 명시 |
| Vercel CDN 위치를 Function 위치로 오인 | 미국 실행을 잘못 판정 | `VERCEL_REGION`과 외부 국가 응답을 각각 확인 |
| 외부 판정 서비스 장애 | 진단 API 실패 | timeout, 비캐시, 안전한 오류 응답 적용 |
| 진단 endpoint가 민감값을 노출 | 보안 위험 | allowlist된 시스템 정보만 반환하고 header/env 전체 출력 금지 |

## 완료 기준

- 로컬 필수 검증 명령이 모두 통과합니다.
- `vercel.json`이 `iad1` 단일 리전을 지정합니다.
- 진단 API가 리전·outbound 결과와 안전한 오류를 구조화해 반환합니다.
- Preview 배포 후 확인할 미국 outbound 검증 절차가 문서화됩니다.

## 승인

- 승인자: 작업지시자
- 승인일: 2026-08-28
- 승인 범위: Vercel 실제 배포 직전까지 전 과정 자동 승인
