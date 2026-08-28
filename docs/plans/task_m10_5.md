# 수행계획서: M1.0 Issue #5 상태·재시도·감사 로그·배포 준비

> 상태: **승인 완료** (2026-08-28)

## 상태

- 상태: 구현·release 검증 완료, 실제 배포 승인 대기
- 작성자: Codex
- 범위: 최근 실행 기록, 재시도 UX, release 검증, Vercel 배포 직전 준비

## 기준 문서

- 이슈: [GitHub Issue #5](https://github.com/jg-vercel/domination-dashboard/issues/5)
- 할일: `docs/orders/20260828.md`
- Preview: `docs/working/preview_us_web_store_purchase.md`
- 수령 안전 설계: `docs/tech/task_m10_4_claim_safety_design.md`

## 목적

사용자가 계정별 최신 수령 결과와 최근 실행을 한 화면에서 확인하고, durable ledger가 성공 계정을 제외한 상태에서 실패·미수령 계정만 안전하게 다시 확인할 수 있도록 MVP 운영 화면을 완성합니다. 이후 실제 Vercel 배포에 필요한 환경·외부 설정·검증 절차를 확정합니다.

## 수행 범위

### 포함

- 최근 50개 batch 감사 기록, 30일 TTL
- cycle, 마스킹 계정, 상태·reason, summary만 포함한 safe audit model
- session 보호 감사 조회 API
- 계정 상태, 다음 09:00 KST, 실행 중·결과·재시도 UI
- 성공·이미 수령·미확정 ledger 유지와 실패·미수령 재조회 설명
- Node 24 release test와 secret scan
- Google Cloud, Upstash, Vercel 환경 설정·Preview·Production 체크리스트

### 제외

- 실제 Vercel project link·배포
- Google Cloud redirect URI 또는 Vercel environment 변경
- Upstash resource 생성·연결
- 실계정 로그인·수령
- 다중 사용자·예약 실행·유료 처리

## 완료 기준

- 최근 실행은 새로고침 뒤에도 Redis에서 조회할 수 있습니다.
- raw credential/full account ID/SKU/offer가 감사 기록에 없습니다.
- success/already/uncertain은 재요청 없이 ledger로 skip되고 실패·미수령만 다시 검증됩니다.
- 다음 reset과 실행 중/결과 상태가 dashboard에 표시됩니다.
- Node 24 필수 명령과 secret scan이 통과합니다.
- 실제 배포에 필요한 사용자 조치가 순서대로 문서화되고 배포 직전에서 중단합니다.

## 승인

- 승인자: 작업지시자
- 승인일: 2026-08-28
- 승인 범위: Vercel 실제 배포 직전까지 전 과정 자동 승인
