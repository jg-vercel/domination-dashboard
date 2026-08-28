# 구현계획서: M1.0 Issue #5 상태·재시도·감사 로그·배포 준비

> 상태: **승인 완료** (2026-08-28)

## 상태

- 상태: 구현·release 검증 완료, 실제 배포 승인 대기
- 작성자: Codex
- 범위: Redis audit, audit API/UI, reset/retry UX, 운영 문서·검증

## 구현 접근

claim batch 완료 후 공개 결과만 JSON으로 직렬화해 관리자 hash 기반 Redis list에 `LPUSH`합니다. pipeline으로 `LPUSH`, `LTRIM 0 49`, `EXPIRE 30d`를 실행하고 감사 저장 실패는 수령 결과를 숨기지 않되 `auditRecorded=false`로 명확히 표시합니다.

dashboard는 server session으로 최근 audit을 조회합니다. 계정 상태와 감사 기록에는 마스킹 ID만 사용합니다. 최근 실행이 있으면 버튼 문구를 “실패·미수령 계정 다시 확인”으로 바꾸며 실제 backend는 cycle ledger로 success/already/uncertain을 skip합니다.

## 변경 대상

- `src/lib/idempotency/redis-rest.ts`
- `src/lib/claims/audit.ts`, `src/lib/claims/service.ts`
- `src/app/api/claims/audit/route.ts`
- `src/app/page.tsx`, `src/components/claim-all-button.tsx`, `src/components/claim-audit-list.tsx`
- 관련 unit·integration 테스트
- `docs/working/task_m10_5_deploy_checklist.md`
- `docs/working/task_m10_5_test_result.md`

## 감사 기록 schema

| 필드 | 공개 여부 |
| --- | --- |
| version, cycleId, executedAt, auditRecorded | 공개 |
| summary status별 개수 | 공개 |
| accountName, maskedAccountId, status, reason | 공개 |
| admin subject/email | 저장하지 않음 |
| full gameAccountId, SKU, offer, token, cookie | 저장하지 않음 |

## 검증 방법

- Redis pipeline command와 최대 50개·30일 expiry 확인
- 손상된 audit JSON 무시 및 허용 status만 수용
- 새로고침 성격의 server read model 테스트
- retry label과 loading disabled, 성공/오류 UI 테스트
- Node 24 lint/typecheck/unit/integration/build
- 추적 파일 secret pattern 및 `.env*` 추적 상태 확인

## 롤백 기준

- 감사 payload에 민감값이 발견되면 audit write/read를 비활성화합니다.
- Redis audit 실패가 idempotency ledger에 영향을 주면 audit 기능을 분리합니다.
- release 검증 실패 시 배포 승인 요청을 하지 않습니다.

## 승인

- 소스 수정 승인자: 작업지시자
- 승인일: 2026-08-28
- 승인 범위: Vercel 실제 배포 직전까지 전 과정 자동 승인
