# 완료보고서: Google 로그인 상태 안내 및 장기 유지 보완

## 상태

- 상태: Git 반영·Production 배포 완료, Google 운영 redirect URI 등록 대기
- 작성자: Codex
- 작성일: 2026-09-14
- 이슈: [Issue #6](https://github.com/jg-vercel/domination-dashboard/issues/6)
- 마일스톤: M1.0 - DomiNations 무료 아이템 수령 대시보드 MVP (#1)
- 브랜치: `local/task6`에서 구현 후 `devel`로 원격 반영
- 승인 근거: 작업지시자 “완료보고서 작성단계까지 진행해”.
- 승인 범위: Preview 보완 → 기존 이슈·브랜치 확인 → 할일·계획 → 구현 → 테스트 → 문서·완료보고서.
- 추가 승인: 2026-09-14 “반영해” — Git 반영·운영 환경 설정·Production 배포·HTTP 검증.

## 요청과 조사 결과

요청은 필요한 때 Google로 로그인하고 재접속 후에도 장기간 로그인 상태를 유지하는 것입니다. 사용자 로그인 정보를 환경변수에 직접 관리하도록 요구해서는 안 됩니다.

기존 코드에는 이미 Google offline OAuth, 암호화 Redis 세션, 180일 idle TTL 및 400일 HttpOnly cookie가 있었습니다. 환경변수에는 사용자 로그인 정보가 아닌 앱의 OAuth Client ID/Secret, 세션 암호화 키, Redis 접속 설정을 사용합니다.

문제의 `Google 설정 필요 / .env.local 확인`은 세션 만료가 아니라 OAuth 또는 Redis 설정 누락 시 표시되는 공통 문구였습니다. 두 설정의 상태를 하나의 boolean으로 합쳐 사용자에게 같은 안내를 보여주고 있었습니다.

읽기 전용 HTTP 확인에서 `https://domination-dashboard.vercel.app/api/auth/google/start`는 `503 AUTH_NOT_CONFIGURED`를 반환했습니다. 기존 운영 기록도 Preview만 설정하고 Production은 인증 설정을 넣지 않았다고 기록합니다. 따라서 운영 주소로 접속했다면 보고된 현상과 일치하지만, 사용자가 접속한 정확한 주소와 기존 cookie 상태는 확인하지 않았으므로 실제 로그아웃 원인을 단정하지 않습니다.

## 구현 결과

| 항목 | 변경 결과 |
| --- | --- |
| 설정 안내 | OAuth·암호화 설정 부족은 `Google 로그인 준비 중`, Redis 설정 부족은 `로그인 저장소 준비 중`으로 구분 |
| 사용자 로그인 | 설정이 정상이고 세션이 없을 때 `Google로 로그인` 제공, `.env.local` 입력 안내 제거 |
| 일시 장애 | 세션 조회가 일시적으로 실패하면 `로그인 상태 확인 지연`과 새로고침 제공 |
| 장기 유지 | 최초 표시 외에도 표시 중 1시간 간격, 탭·온라인 복귀 시 갱신 |
| 요청 제어 | 이벤트 최소 간격 5분, 숨겨진 탭 갱신 생략, 요청 중복 방지, cleanup 적용 |
| 확정된 만료 | session API에서 무효 cookie 폐기, keepalive 401에서 서버 UI 갱신 및 추가 요청 중단 |
| 일시 장애 보호 | 네트워크/502/503만으로 cookie를 지우거나 재로그인 화면으로 전환하지 않음 |
| 문서 | Preview 후속 승인, 할일, 수행·구현계획, README, 테스트 결과, 현재 단계, 본 보고서 작성 |

기존 세션 형식, Redis 키, 암호화 키 및 TTL 정책은 변경하지 않았습니다. 이번 변경 자체에 따른 기존 세션 데이터 마이그레이션은 필요하지 않습니다.

## 검증 결과

- 단위 테스트: 26 files, 678 tests 통과.
- 통합 테스트: 7 files, 63 tests 통과.
- lint, typecheck, production build 통과. 최종 UI 수정 후 관련 6개 테스트 및 lint/build 재확인.
- 최초 로그인 358일 후에도 중간 정상 활동으로 세션이 유지되고 만료가 연장되는 것을 가상 시각으로 검증.
- 로컬 HTTP 200과 새 안내 출력 확인. 환경 미설정 로그인 API는 503 유지.
- 자세한 명령·기대 결과·검증 한계: [테스트 결과](../working/task_m10_6_test_result_v2.md).

## 운영 반영 결과

- 운영 URL: https://domination-dashboard.vercel.app
- 배포 ID: `dpl_6nhBpxAXhJUZKT54zPqdtSra3so7`
- 배포 URL: https://domination-dashboard-gyzdvobio-mintmd95-4401s-projects.vercel.app
- 상태: `READY`, target `production`, Function region `iad1`
- 배포 코드 커밋: `b118e39` (`devel` 원격 반영)
- Google Client ID/Secret, Redis URL/Token의 기존 Secret을 복호화·노출하지 않고 Preview+Production target으로 확장했습니다.
- Production `APP_BASE_URL`을 운영 URL로 설정하고 운영 전용 `APP_SESSION_SECRET`을 새로 생성했습니다. Preview의 키는 보존했습니다.
- 새 운영 키는 향후 배포에도 고정 유지해야 합니다. 불필요한 키 교체는 기존 로그인을 무효화합니다.
- Vercel 원격 빌드 및 TypeScript 검사가 통과했고 운영 별칭이 새 배포에 연결됐습니다.

| 운영 검증 | 결과 |
| --- | --- |
| 대시보드 | 200, `Google로 로그인` 표시, 기존 설정 경고 없음 |
| Health | 200 |
| 실행 리전 | `iad1`, 일치 |
| 외부 요청 국가 | US, `asia=false`, `targetMet=true` |
| 미로그인 session POST | 401 `AUTH_REQUIRED` |
| Google 로그인 시작 | 307 → `accounts.google.com`, offline OAuth 및 운영 callback 일치 |
| OAuth flow cookie | Secure, HttpOnly 확인 |
| Google 인증 페이지 | `redirect_uri_mismatch`, 운영 callback 미허용 |

## 남은 사항: Google Cloud 콜백 등록

**운영 배포와 환경변수 오류 복구는 완료됐지만 실제 Google 로그인은 아직 완료할 수 없습니다.** Google이 현재 운영 콜백을 허용하지 않아 인증 페이지에서 `redirect_uri_mismatch`를 반환합니다.

Google Cloud Console의 사용 중인 Web OAuth 클라이언트에서 **승인된 리디렉션 URI**에 아래 주소를 추가해야 합니다. 기존 Preview URI는 유지합니다.

```text
https://domination-dashboard.vercel.app/api/auth/google/callback
```

- 설정 위치: https://console.cloud.google.com/auth/clients
- 현재 Google Cloud connector·CLI 및 연결 가능한 Browser가 없어 이 등록은 직접 수행하지 못했습니다.
- URI 등록 후 실제 계정 로그인, 브라우저 재시작·재접속, 세션 갱신 및 로그아웃 검증이 필요합니다.
- 시각 검증은 Browser 연결 부재로 미실시했습니다. 배포본의 HTML 및 HTTP/OAuth 응답으로 확인했습니다.
- Redis 실제 로그인 세션 생성·갱신은 OAuth 완료 이후 검증할 사항입니다.

반영구적 사용 경험은 정상 활동으로 세션을 연장하는 방식입니다. 180일 미접속, cookie 삭제, 서버 세션 삭제, 암호화 키 변경, Google 권한 취소 등에는 재로그인이 필요할 수 있으며 Google 토큰의 영구 유효성을 보장하지 않습니다. [Google OAuth 공식 문서](https://developers.google.com/identity/protocols/oauth2)

## Git 및 종료 상태

기존 등록된 M1.0 / Issue #6의 후속 작업으로 `local/task6`에 `b118e39`를 커밋하고 동일 내용의 `devel` 브랜치를 생성·push했습니다. 운영 배포는 명시적인 CLI `--prod`로 수행했습니다. 기존 사용자 파일과 미추적 파일은 보존했고 배포 대상에서도 제외했습니다. PR merge 및 실수령은 수행하지 않았습니다.

기존 Vercel Git Production branch 설정은 `local/task1`이며 이번에 바꾸지 않았습니다. `devel` push 자체는 운영 배포가 아니며 이후 자동 운영 배포 전략 변경은 별도로 관리해야 합니다.

이슈는 열린 상태로 유지했습니다. 종료 승인이나 이슈 클로즈를 수행하지 않았습니다. 추후 종료 시 이슈 comment 확인 및 작업지시자 승인 절차를 적용합니다.
