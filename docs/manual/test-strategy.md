# 테스트 전략

## 상태

- 상태: 승인 완료
- 작성자: Codex
- 범위: M1.0 대시보드 MVP 로컬 및 배포 전후 테스트 기준

## 테스트 종류

| 종류 | 명령 | 실행 시점 |
| --- | --- | --- |
| 린트 | `pnpm lint` | 소스 변경 후 및 이슈 종료 전 |
| 타입체크 | `pnpm typecheck` | 소스 변경 후 및 이슈 종료 전 |
| 단위 테스트 | `pnpm test` | domain/adapter/UI 동작 변경 후 |
| 통합 테스트 | `pnpm test:integration` | Route Handler 또는 외부 adapter 변경 후 |
| 빌드 검증 | `pnpm build` | 커밋 전 및 배포 승인 요청 전 |

## 배포 환경 검증

- `/api/system/region` 응답의 `runtimeRegion`이 `iad1`인지 확인합니다.
- `/api/system/outbound-country` 응답의 대상 서비스 판정이 `US`, `asia: false`인지 확인합니다.
- 위 두 검증은 실제 Vercel Preview 배포가 있어야 완료할 수 있으므로 로컬 검증과 분리해 기록합니다.
- 응답과 로그에 cookie, OAuth token, secret을 포함하지 않습니다.

## 실패 처리

- 필수 명령 중 하나라도 실패하면 이슈 완료로 처리하지 않습니다.
- 외부 서비스 장애는 HTTP 상태와 안전한 오류 코드만 기록하고 재시도 폭주를 금지합니다.
- 실제 계정 상태를 변경하는 통합 테스트는 작업지시자의 명시적 실행으로만 수행합니다.
