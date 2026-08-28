# 수행계획서: M1.0 Issue #1 연동 적격성 조사

> 상태: **완료·보관** (2026-08-28)

## 상태

- 상태: 완료
- 작성자: Codex
- 범위: DomiNations World Google session, 게임 계정 3개, 무료 아이템 수령 흐름과 미국 서버 실행 가능성 조사

## 기준 문서

- 이슈: [GitHub Issue #1](https://github.com/jg-vercel/domination-dashboard/issues/1)
- 할일: `docs/orders/20260828.md`
- Preview: `docs/working/preview_us_web_store_purchase.md`
- 마일스톤 파일명 매핑: GitHub `M1.0`을 문서 파일명에서 `m10`으로 표기

## 목적

코드 구현 전에 승인된 범위가 실제 DomiNations World 흐름과 Vercel 환경에서 성립하는지 확인합니다. 조사 결과는 Issue #2 이후의 개발 스택, 인증, 데이터 모델, 수령 API 경계와 중단 조건의 근거가 됩니다.

## 수행 범위

### 포함

- DomiNations World 공개 로그인 및 Web Store 구조 확인
- Google 로그인 후 사용할 수 있는 공식 session 위임 방식의 제약 조사
- Google 계정 1개에 연결된 게임 계정 3개의 식별·선택 요구사항 조사
- `Web Specials > Free Legendary Token`의 가격 0, 수령 자격, 오전 9시 갱신, 결과 확인 요구사항 조사
- Vercel Node.js Function `iad1`과 outbound 국가의 관계 조사
- 허용된 공식 요청 방식과 구현 중단 조건 정리

### 제외

- Google 비밀번호 수집 또는 저장
- 실제 사용자 계정 로그인과 무료 아이템 수령 실행
- CAPTCHA, 지역 통제 또는 계정 자격 우회
- 비공개 API reverse engineering
- headless browser 자동 조작
- 신규 애플리케이션 소스 생성 및 Vercel 배포

## 단계

1. 공식 페이지, 이용약관, Vercel 공식 문서를 확인합니다.
2. 대상 사이트가 공개한 HTML, JavaScript 및 공개 요청 경계를 읽기 전용으로 확인합니다.
3. Google session, 게임 계정 선택, 무료 아이템 수령에 필요한 사용자 상호작용과 서버 책임을 구분합니다.
4. 미국 `iad1` Function 실행만으로 지역 조건이 충족될 가능성과 추가 판정 요인을 정리합니다.
5. 확인된 사실, 추론, 미확인 항목을 분리해 기술 조사 문서로 작성합니다.
6. Issue #2 진행 가능 여부와 선행 사용자 조치를 결론으로 제시합니다.

## 산출물

- `docs/tech/task_m10_1_integration_research.md`
- 필요 시 `docs/troubleshootings/`의 접근 제한 기록
- GitHub Issue #1 조사 결과 comment

## 위험 및 대응

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| 로그인 전에는 상품·계정 요청을 볼 수 없음 | session 및 수령 경계 미확정 | 공개 범위를 먼저 조사하고 필요한 사용자 로그인 검증을 별도 조건으로 기록 |
| Google session 자동 재사용이 허용되지 않음 | 서버 기반 연동 불가 | 공식 OAuth/session 위임만 사용하고 사용자 재로그인 흐름으로 축소 |
| 공개 리소스만으로 요청 의미를 확정할 수 없음 | 잘못된 API 가정 | 사실과 추론을 분리하고 구현 전에 실제 로그인 세션에서 재검증 |
| 미국 서버 IP 외에 계정 지역을 사용함 | Vercel 리전만으로 상품 미노출 | 계정 자격 판정으로 결론 내리고 우회 구현 중단 |
| 이용약관상 자동 요청이 허용되지 않음 | 계정 제한 위험 | 버튼 기반 공식 요청 또는 공식 Web Store 이동으로 범위 축소 |

## 검증 방법

- DomiNations World 및 Vercel 공식 자료를 우선 근거로 사용합니다.
- 공개 리소스의 URL, 요청 경계와 관찰 일자를 기록합니다.
- 로그인·수령 관련 결론마다 `확인됨`, `추론`, `사용자 세션 검증 필요`를 구분합니다.
- preview 수용 기준과 실패·중단 조건에 조사 결과를 대조합니다.

## 완료 기준

- Issue #1의 성공 기준이 항목별로 판정됩니다.
- Issue #2에서 사용할 네트워크·인증·계정·아이템 경계가 정리됩니다.
- 사용자 로그인이 필요한 미확인 항목과 안전한 검증 절차가 명시됩니다.
- 허용되지 않은 우회 없이 구현 가능한지 결론이 제시됩니다.

## 승인

- 승인자: 작업지시자
- 승인일: 2026-08-28
- 승인 범위: Vercel 실제 배포 직전까지 전 과정 자동 승인

---

## 승인 이력

| 구분 | 승인 일자 |
| --- | --- |
| 수행계획서 | 2026-08-28 |
