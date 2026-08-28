# 구현계획서: M1.0 Issue #1 조사 실행

> 상태: **완료·보관** (2026-08-28)

## 상태

- 상태: 완료
- 작성자: Codex
- 범위: Issue #1의 읽기 전용 기술 조사 실행 방법

## 기준 문서

- 이슈: [GitHub Issue #1](https://github.com/jg-vercel/domination-dashboard/issues/1)
- 할일: `docs/orders/20260828.md`
- 수행계획서: `docs/plans/archives/task_m10_1.md`

## 구현 접근

Issue #1에서는 애플리케이션 소스를 구현하지 않습니다. 공식 문서, 대상 사이트의 공개 HTML/JavaScript, 공개 HTTP 응답과 로그인 전 UI를 읽기 전용으로 조사합니다. 인증된 사용자 session 없이는 계정·아이템 요청을 실행하지 않으며, Google 비밀번호나 session token을 수집하지 않습니다.

조사 중 로그인 후 네트워크 확인이 반드시 필요해지면 가능한 공식 브라우저 session을 사용하고, 브라우저가 제공되지 않으면 미확인 항목으로 남겨 작업지시자의 안전한 상호작용을 요청합니다.

## 조사 대상

- `https://www.dominationsworld.com/web-store`
- DomiNations World의 공개 login 및 Google login 진입점
- Web Store가 제공하는 공개 script와 요청 대상 host
- Vercel Function region 및 outbound 관련 공식 문서
- DomiNations World 이용약관의 자동화 제한

## 조사 절차

1. 공식 Web Store 응답 header, HTML 및 script 목록을 수집합니다.
2. 공개 script에서 인증·계정·store 관련 host와 route 이름을 정적 검색합니다.
3. 로그인 전 호출되는 공개 요청만 관찰하고 상태 코드·CORS·cookie 경계를 기록합니다.
4. Google 인증은 redirect URI와 사용자 상호작용 요구사항만 확인합니다.
5. 게임 계정 3개 선택과 아이템 수령은 공개 근거가 없으면 추론으로 확정하지 않습니다.
6. Vercel `iad1` Node.js Function의 실행·outbound 특성을 공식 문서와 대조합니다.
7. 결과를 기술 조사 문서에 사실, 추론, 미확인 항목, 구현 결정으로 구분해 기록합니다.

## 변경 대상

- `docs/tech/task_m10_1_integration_research.md`
- `docs/orders/20260828.md`
- `docs/working/CURRENT_STAGE.md`
- GitHub Issue #1 comment

Issue #1에서는 애플리케이션 소스 파일을 변경하지 않습니다.

## 위험 및 대응

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| script가 minify되어 의미가 불명확함 | 잘못된 endpoint 해석 | 문자열·host 수준만 근거로 사용하고 인증 session에서 재검증 |
| 공개 HTTP 확인이 보안 통제로 차단됨 | 조사 범위 축소 | 반복 우회하지 않고 차단 사실과 필요한 사용자 검증을 기록 |
| Google 인증이 실제 브라우저를 요구함 | CLI 조사 불가 | 비밀번호를 받지 않고 브라우저 사용자 승인 단계로 분리 |
| 수령 요청을 오인해 실제 상태를 변경함 | 의도하지 않은 수령 | Issue #1에서는 상태 변경 요청을 절대 전송하지 않음 |

## 검증 방법

- `curl`과 공개 리소스 정적 확인 결과를 재현 가능한 명령과 함께 기록합니다.
- 민감 header, cookie, token은 출력·저장하지 않습니다.
- 외부 사실은 공식 URL과 확인일을 기록합니다.
- 상태 변경 가능성이 있는 요청은 실행하지 않습니다.

## 롤백 기준

- 조사 문서 외 파일이 변경되면 해당 변경을 중단하고 범위를 재검토합니다.
- 로그인·수령 상태 변경 가능성이 발견되면 요청 실행 전 중단합니다.
- 대상 사이트가 자동 접근을 명시적으로 거부하면 추가 HTTP 조사를 중단합니다.

## 승인

- 소스 수정 승인자: 작업지시자
- 승인일: 2026-08-28
- 승인 범위: Vercel 실제 배포 직전까지 전 과정 자동 승인

---

## 승인 이력

| 구분 | 승인 일자 |
| --- | --- |
| 조사 실행계획서 | 2026-08-28 |
