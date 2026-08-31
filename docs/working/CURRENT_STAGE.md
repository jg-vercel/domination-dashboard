# 현재 단계 상태

## 상태

- 상태: 진행중
- 작성자: Codex
- 범위: 현재 작업 단계와 승인 상태 기록

## 현재 단계

- 현재 단계: M1.0 Vercel Preview 인프라 검증 완료, Google OAuth·실계정 수용 검증 대기
- 승인 상태: Vercel Preview 배포 승인 완료 (2026-08-31)
- 대상 문서: `docs/working/preview_us_web_store_purchase.md`
- Git 호스트: GitHub
- Git remote: `origin`
- 원격 저장소: `https://github.com/jg-vercel/domination-dashboard.git`
- 원격 상태: 접근 가능, `local/task5` push 완료 및 Vercel Git 연결 완료
- Milestone: `M1.0 - DomiNations 무료 아이템 수령 대시보드 MVP` (#1)
- 등록 Issue: #1, #2, #3, #4, #5
- 완료 Issue: `#1 [조사] DomiNations World Google 세션 및 무료 토큰 수령 흐름 검증`
- 배포 검증 완료·종료 승인 대기 Issue: `#2 [기반] 신규 대시보드와 Vercel 미국 리전 PoC 구축`
- 진행 Issue: `#3 [연동] Google 로그인과 게임 계정 3개 조회 구현`
- 진행 Issue: `#4 [기능] Free Legendary Token 3계정 일괄 수령 구현`
- 진행 Issue: `#5 [UI/배포] 수령 상태 대시보드·재시도·Vercel 배포`
- 현재 브랜치: `local/task5`
- 오늘할일: `docs/orders/20260828.md` Issue #2~#5 로컬 항목 완료
- 수행계획서: `docs/plans/task_m10_2.md` 구현·로컬 검증 완료
- 구현계획서: `docs/plans/task_m10_2_impl.md` 구현·로컬 검증 완료
- 테스트 결과: `docs/working/task_m10_2_test_result.md` 로컬 검증 완료
- Issue #3 수행계획서: `docs/plans/task_m10_3.md` 구현·mock 검증 완료
- Issue #3 구현계획서: `docs/plans/task_m10_3_impl.md` 구현·mock 검증 완료
- Issue #3 테스트 결과: `docs/working/task_m10_3_test_result.md` 로컬 검증 완료
- Issue #4 수행계획서: `docs/plans/task_m10_4.md` 구현·mock 검증 완료
- Issue #4 구현계획서: `docs/plans/task_m10_4_impl.md` 구현·mock 검증 완료
- Issue #4 테스트 결과: `docs/working/task_m10_4_test_result.md` 로컬 검증 완료
- Issue #5 수행계획서: `docs/plans/task_m10_5.md` release 검증 완료
- Issue #5 구현계획서: `docs/plans/task_m10_5_impl.md` release 검증 완료
- Issue #5 테스트 결과: `docs/working/task_m10_5_test_result.md` Vercel Preview 인프라 검증 반영
- 배포 체크리스트: `docs/working/task_m10_5_deploy_checklist.md` Preview 실행 결과 반영
- Vercel project: `mintmd95-4401s-projects/domination-dashboard`
- Preview 고정 별칭: `https://domination-dashboard-preview.vercel.app` (Vercel Authentication 보호)
- Preview deployment: `dpl_99RgeYD5GAJ7wMVq8ohCNFD42uwV`, Ready, `iad1`
- Upstash resource: `domination-dashboard-redis`, `iad1`, Free, Preview 전용, auto-upgrade 비활성
- Preview 환경 변수: Redis 2개, `APP_SESSION_SECRET`, `APP_BASE_URL` 설정 완료
- 기술 조사: `docs/tech/task_m10_1_integration_research.md` 완료
- 최종 보고서: `docs/report/task_m10_1_report.md` 완료

## 확인 필요

- Google OAuth Web client의 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_GOOGLE_EMAIL`은 아직 Preview에 없습니다.
- Google Cloud Authorized redirect URI에 `https://domination-dashboard-preview.vercel.app/api/auth/google/callback` 등록이 필요합니다.
- Preview는 `runtimeRegion=iad1`, outbound `US`, `asia=false`, `targetMet=true`까지 확인했습니다.
- Upstash REST 연결은 `PING -> PONG`으로 확인했습니다.
- Issue #2는 기술 성공 기준을 충족했지만 comment 확인 및 작업지시자의 종료 승인 전까지 닫지 않습니다.
- Issue #3 실계정 검증에는 작업지시자 소유 Google OAuth 환경 변수와 브라우저 로그인이 필요합니다.
- 실계정 검증 전까지 계정·상품 조회 성공을 단정하지 않고 수령 기능을 fail-closed로 유지합니다.
- Issue #4의 Redis 선행 조건은 충족했으며 실제 session 상품 검증은 아직 필요합니다.
- 실제 수령은 mock 외에는 실행하지 않았고 사용자 버튼 전까지 자동 실행 경로가 없습니다.
- Vercel CLI 첫 배포 정책으로 `--prod` 없이도 최초 배포 `dpl_vxs3cSF2s6XBTKmKA9W3vsZohCFc`가 Production target에 자동 지정됐습니다. Production 환경 변수는 주입하지 않아 인증·수령은 503 fail-closed입니다.
- Production 주소 `https://domination-dashboard.vercel.app`의 추가 설정·재배포·실사용은 별도 승인 전까지 진행하지 않습니다.
- Issue #2~#5는 comment 확인과 실계정 검증 또는 작업지시자 종료 승인 전까지 닫지 않습니다.
- Vercel CLI는 `mintmd95-4401`로 로그인되어 있습니다.
