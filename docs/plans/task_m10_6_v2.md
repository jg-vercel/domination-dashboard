# 수행계획서: 로그인 상태 안내와 장기 유지 보완

> 상태: **승인 완료** (2026-09-14)

- 실행 상태: 구현·로컬 검증·완료보고서 작성 완료, 최종 검토 대기.
- 결과: `docs/report/task_m10_6_report_v2.md`.

- 작성자: Codex
- 이슈: https://github.com/jg-vercel/domination-dashboard/issues/6
- 할일: `docs/orders/20260914.md`
- Preview: `docs/working/preview_long_lived_google_session.md`
- 승인자: 작업지시자
- 승인 근거: “완료보고서 작성단계까지 진행해” — 구현·테스트·완료보고서까지 일괄 진행.

## 구현 접근

기존 장기 세션 구조를 유지하고 설정 누락을 로그인 만료처럼 표시하는 UI와 최초 mount에서만 갱신하는 동작을 보완합니다. 기존 등록 이슈와 브랜치를 재사용합니다.

## 변경 대상

- 인증 상태 UI, session keepalive, session Route Handler
- 관련 단위·통합 테스트, README 및 작업 문서

## 위험 및 대응

- 일시적 Redis/네트워크 장애: cookie를 지우지 않고 이후 활동에서 재시도합니다.
- 무효 세션: 401에서 cookie를 폐기하고 서버 UI를 갱신합니다.
- 요청 중복: 진행 중 요청과 짧은 간격의 이벤트를 제한합니다.
- 운영 설정 부재: 실제 설정·배포를 완료했다고 주장하지 않고 증거와 후속 사항을 기록합니다.

## 검증 방법

프로젝트 scripts의 test, test:integration, lint, typecheck, build와 `git diff --check`. Mock 시간으로 180일 이후 연장·유휴 만료를 검증합니다.

## 롤백 기준

세션 유출, 갱신 요청 반복, 정상 세션 폐기가 발생하면 이번 변경만 되돌립니다. 기존 사용자 파일은 보존합니다.
