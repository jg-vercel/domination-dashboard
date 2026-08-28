# DomiNations World 미국 리전 무료 아이템 수령 대시보드 Preview

> 상태: **승인 완료** (2026-08-28)

## 상태

- 상태: 승인됨
- 작성자: Codex
- 작성일: 2026-08-28
- 우선순위: P0
- 범위: 미국 Vercel 리전에서 Google 기반 DomiNations World 계정에 연결된 게임 계정 3개의 무료 아이템을 사용자의 버튼 조작으로 수령하는 첫 개인용 웹 대시보드

## 목적

VPN 클라이언트를 운영하지 않고 Vercel의 미국 리전에서 서버 요청을 실행하여 DomiNations World Web Store의 지역별 무료 아이템 접근 가능성을 검증하고, 작업지시자가 대시보드 버튼을 눌렀을 때 Google 계정 1개에 연결된 게임 계정 3개가 각각 하루 1회 `Web Specials > Free Legendary Token`을 수령할 수 있게 합니다.

무료 아이템의 갱신 시각은 한국 기준 오전 9시로 전제합니다. 대시보드는 계정별 당일 수령 결과와 다음 갱신 시각을 표시하고, 일부 계정 실패 시 이미 수령한 계정을 제외한 수동 재시도를 제공합니다. 대상 아이템은 가격이 0이고 별도 결제나 checkout이 없는 것으로 전제합니다. 유료 상품 구매와 결제수단 처리는 범위에 포함하지 않습니다.

## 요청 요약

- 대상: [DomiNations World Web Store](https://www.dominationsworld.com/web-store)
- 배포: Vercel
- 네트워크 방향: VPN이 아닌 미국 Vercel Function 리전
- 애플리케이션 상태: 이 workspace에서 새로 시작하는 첫 애플리케이션
- 로그인: Google 계정 1개로 DomiNations World 로그인
- 대상 게임 계정: 위 Google 계정에 연결된 게임 계정 3개
- 대상 아이템: `Web Specials > Free Legendary Token`
- 갱신 시각: `Asia/Seoul` 기준 매일 오전 9시
- 실행 방식: 작업지시자가 대시보드의 수령 버튼을 직접 누름
- 수령 주기: 게임 계정별 갱신 주기당 1회
- 핵심 기능: Google 계정 연동, 미국 지역 무료 아이템 조회, 3개 게임 계정 일괄 수령, 실패 계정 재시도 및 계정별 결과 확인

## 사전 조사 결과

1. DomiNations World Web Store는 로그인 흐름을 제공하며, 페이지에 지역 미지원 상태(`This feature is not available in your region`)가 정의되어 있습니다.
2. Vercel의 신규 프로젝트 Function 기본 리전은 미국 Washington, D.C.의 `iad1`이며, 프로젝트 또는 Function 단위로 리전을 지정할 수 있습니다. 정적 화면의 CDN 위치와 서버 Function 실행 위치는 별개입니다.
3. Vercel Function의 기본 outbound 요청은 동적 IP 범위를 사용합니다. 고정 IP가 필요하면 Pro/Enterprise의 Static IPs 또는 Enterprise의 Secure Compute를 별도로 검토해야 합니다.
4. DomiNations World 이용약관은 승인되지 않은 bot 및 제3자 자동화 소프트웨어 사용에 제한을 두고 있습니다. 따라서 공식 요청 방식 또는 운영사의 허용이 확인되지 않은 headless browser 수령 자동화는 기본 범위에 포함하지 않습니다.
5. 미국 Function에서 요청을 보낸다는 사실만으로 무료 아이템 수령이 보장되지는 않습니다. 스토어가 계정 지역, 브라우저 위치, 데이터센터 IP 또는 계정별 수령 자격을 추가로 사용할 수 있기 때문입니다.

참고 자료:

- [Vercel Function 리전 설정](https://vercel.com/docs/functions/configuring-functions/region)
- [Vercel outbound 고정 IP 안내](https://vercel.com/kb/guide/how-to-allowlist-deployment-ip-address)
- [DomiNations World 이용약관](https://www.dominationsworld.com/terms-of-use)
- [DomiNations World Web Store](https://www.dominationsworld.com/web-store)

## 제안 범위

### 포함

- 단일 관리자만 접근 가능한 대시보드 인증
- Vercel Node.js Function의 `iad1` 고정 및 실제 실행 리전 표시
- 중립적인 IP 확인 서비스와 대상 스토어 요청을 이용한 미국 outbound 검증
- 허용된 공식 방식에 한한 Google 기반 DomiNations World 로그인/session 연동
- 연결된 게임 계정 3개의 식별과 개별 수령 대상 관리
- 각 게임 계정의 `Web Specials > Free Legendary Token` 노출 및 수령 가능 여부 조회
- `Asia/Seoul` 기준 오전 9시 갱신 주기 계산과 다음 갱신 시각 표시
- 인증된 관리자만 사용할 수 있는 `3개 계정 모두 수령` 버튼
- 게임 계정별 갱신 주기 idempotency key와 실행 잠금
- 버튼 실행 직전 가격 0 및 수령 자격 재확인
- 허용된 공식 요청 방식을 통한 게임 계정별 무료 아이템 수령 실행
- 실패 계정만 다시 실행하는 수동 재시도 버튼
- 계정별 수령 성공, 이미 수령함, 자격 없음, 실패, 미확정 상태와 다음 실행 시각 표시
- 민감정보를 제거한 감사 로그
- Vercel 배포 및 운영 확인

### 제외

- VPN 또는 residential proxy 운영
- 허위 미국 주소 또는 신원 정보 사용
- CAPTCHA, 계정 자격 또는 지역 통제 우회
- 유료 상품 구매와 결제수단 처리
- 승인 여부가 확인되지 않은 비공개 API reverse engineering
- 운영사 허용 없이 headless browser로 로그인·수령 버튼을 자동 조작하는 기능
- 타인 계정, 다중 사용자 또는 재판매 목적의 수령
- 당일 수령 완료 계정에 대한 반복 실행 또는 수령 제한 우회
- Vercel Cron 등 사용자 조작 없는 예약 수령

## 목표 사용자 흐름

1. 작업지시자가 개인 대시보드에 Google 로그인합니다.
2. 대시보드는 미국 `iad1` Function의 실행 리전과 outbound 국가를 확인합니다.
3. 허용된 연동 방식으로 Google 기반 DomiNations World session을 확인하거나 갱신합니다.
4. 연결된 게임 계정 3개와 각 계정의 `Free Legendary Token` 수령 가능 상태를 표시합니다.
5. 작업지시자가 `3개 계정 모두 수령` 버튼을 누릅니다.
6. 서버는 오전 9시 기준 현재 갱신 주기와 계정별 기존 수령 기록을 확인합니다.
7. 이미 수령한 계정은 건너뛰고, 나머지 계정마다 아이템 식별자, 가격 0, 수령 가능 상태를 다시 검증합니다.
8. 서버는 `갱신 주기 + 게임 계정 + 아이템` idempotency key를 사용해 각 수령 요청을 한 번만 전송합니다.
9. 공식 응답 또는 수령 상태 재조회로 계정별 최종 결과를 확인하고 대시보드에 기록합니다.
10. 일부 계정이 실패하거나 미확정이면 해당 계정만 `다시 수령` 버튼으로 재시도합니다.

## 제안 아키텍처

```text
[개인 브라우저]
      |
      v
[관리자 대시보드]
      |
      v
[Vercel Node.js Function / iad1]
      |-- [리전·outbound 검증]
      |-- [Google 기반 DomiNations session 저장소]
      |-- [연결된 게임 계정 3개 조회]
      |-- [계정별 갱신 주기 idempotency·감사 로그 DB]
      |
      v
[게임 계정별 DomiNations 공식 무료 아이템 수령 요청]
      |
      v
[공식 응답 또는 수령 상태 조회]
```

### 네트워크 결정

- 수령 관련 서버 Function은 Edge Runtime이 아닌 Node.js Runtime을 우선 사용합니다.
- 기본 배포 리전은 `iad1` 한 곳으로 고정합니다.
- 프런트엔드 정적 파일이 한국과 가까운 CDN에서 제공되어도 수령 서버 요청은 `iad1`에서 실행되도록 분리합니다.
- 1차 PoC는 Vercel 기본 동적 outbound IP로 수행합니다.
- 대상 스토어가 동적/공유 데이터센터 IP를 거부하거나 IP 일관성이 요구될 때만 Static IPs 비용과 적용 가능성을 재검토합니다.

### 인증 및 secret 결정

- 대시보드 관리자와 DomiNations World 모두 작업지시자의 Google 계정을 기준으로 연동합니다.
- Google 비밀번호를 입력받거나 DB, Vercel 환경 변수, 로그, 브라우저 저장소에 보관하지 않습니다.
- 최초 브라우저 승인으로 발급된 공식 OAuth/session 위임을 우선 사용합니다.
- DomiNations World session이 만료되면 작업지시자가 대시보드에서 다시 로그인한 뒤 수령 버튼을 누르도록 합니다.
- session 만료, 추가 인증, CAPTCHA 발생 시 자동 우회하지 않고 사용자 조치가 필요한 상태로 전환합니다.

### 무료 아이템 수령 결정

- 기본안은 `3개 계정 모두 수령 버튼 -> 계정별 서버 자격 재확인 -> 계정별 공식 수령 요청`입니다.
- 대상은 `Web Specials > Free Legendary Token`으로 고정합니다.
- 오전 9시부터 다음 날 오전 8시 59분 59초까지를 같은 수령 주기로 계산하되, 대상 사이트가 반환하는 실제 수령 가능 상태를 최종 기준으로 사용합니다.
- 서버가 가격 0을 확인하지 못하면 요청을 보내지 않습니다.
- 응답이 불명확하면 제한된 횟수의 상태 조회로 실제 수령 여부를 확인합니다.
- 타임아웃은 실패가 아닌 `미확정`으로 기록하여 재시도로 인한 중복 요청을 막습니다.

## 단계별 제안

| 단계 | 목표 | 완료 기준 |
| --- | --- | --- |
| 1. 적격성·연동 조사 | 지역 제한과 Google session 기반 공식 연동 가능성 확인 | 버튼 수령 허용 범위, session 방식, 게임 계정 3개와 `Free Legendary Token` 흐름이 문서화됨 |
| 2. 미국 리전 PoC | Vercel `iad1`의 실제 outbound 검증 | 실행 리전과 외부 관측 국가가 미국으로 확인됨 |
| 3. 계정·상품 연동 | Google session과 게임 계정 3개 및 무료 아이템 조회 | Google 비밀번호 없이 계정별 아이템/수령 자격을 조회함 |
| 4. 무료 수령 | 계정별 안전한 수령 요청과 수동 실행 연결 | 가격 0 재검증, idempotency, 이미 수령/실패 처리가 동작함 |
| 5. 결과 추적·배포 | 계정별 수령 상태와 운영 결과 제공 | 3개 계정의 버튼 처리, 실패 재시도, 결과 추적 및 Vercel 운영 검증 완료 |

각 단계는 별도 issue 후보이며, preview 승인 전에는 Git milestone이나 issue를 등록하지 않습니다.

## 수용 기준

- 대시보드의 수령 관련 API가 Vercel `iad1`에서 실행됨을 서버가 증명합니다.
- 대상 스토어로 나가는 요청의 관측 국가가 미국임을 테스트 결과로 기록합니다.
- 한국 클라이언트 요청이 수령 서버 Function을 한국/아시아 리전으로 이동시키지 않습니다.
- 로그인 secret과 session token이 클라이언트 응답과 로그에 노출되지 않습니다.
- Google 비밀번호를 애플리케이션이 수집하거나 저장하지 않습니다.
- 연결된 게임 계정 3개를 서로 다른 수령 대상으로 식별합니다.
- 작업지시자가 버튼을 누르면 현재 오전 9시 갱신 주기에서 게임 계정 3개를 각각 최대 1회 수령 처리합니다.
- 수령 요청 직전에 무료 아이템명, 해당 게임 계정, 가격 0, 수령 가능 상태를 서버에서 다시 확인합니다.
- 동일 갱신 주기·게임 계정·아이템 조합의 요청 재전송이 중복 실행으로 이어지지 않습니다.
- 수령 성공은 계정별 공식 응답 또는 공식 상태 조회로만 확정합니다.
- 일부 계정 실패 시 이미 수령한 계정을 제외하고 실패/미수령 계정만 재시도할 수 있습니다.
- CAPTCHA 또는 추가 본인 확인은 사용자에게 넘기고 우회하지 않습니다.
- 대상 사이트 정책상 허용되지 않는 것으로 확인되면 실제 수령 자동화를 중단합니다.

## 실패·중단 조건

- 미국 `iad1` 요청에서도 대상 상품이 계정에 노출되지 않음
- 지역 판정이 서버 IP가 아닌 계정 국가 또는 별도 계정 자격에 고정됨
- 공식 연동 수단이 없고 운영사가 제3자 로그인/수령 자동화를 허용하지 않음
- 대상 사이트가 Vercel 공유/데이터센터 IP를 차단함
- Google 기반 DomiNations session을 안전하게 설정할 공식 로그인 흐름이 없음
- 로그인에 지속적인 CAPTCHA 또는 기기 승인 절차가 필요함
- 수령 요청 또는 결과 확인을 위한 공식 인터페이스가 제공되지 않음
- 허위 소재지 정보나 지역 통제 우회 없이는 수령이 성립하지 않음

중단 조건이 발생하면 기술적 우회 구현으로 자동 전환하지 않고 작업지시자에게 결과와 대안을 보고합니다.

## 주요 위험과 대응

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| 이용약관 위반 | 계정 제한 또는 서비스 차단 | 공식 요청 방식 우선, 필요 시 운영사 서면 확인 |
| 미국 리전과 수령 자격 불일치 | 아이템 미노출 또는 수령 거절 | IP 지역과 계정 자격을 1단계에서 분리 검증 |
| shared egress 차단 | 로그인/상품 조회 실패 | Static IPs 검토, residential proxy로 우회하지 않음 |
| Google/DomiNations session 유출 | 계정 탈취 | Google 비밀번호 미수집, token 최소 보관, 암호화, 로그 redaction, 관리자 재인증 |
| Google/DomiNations session 만료 | 버튼 실행 실패 | 재로그인 필요 상태를 명확히 표시하고 수령 요청은 보내지 않음 |
| 중복 클릭 또는 동시 요청 | 중복 수령 요청 | 계정별 갱신 주기 idempotency와 실행 잠금 |
| 중복 수령 요청 | 계정 상태 불일치 또는 요청 제한 | idempotency key, 단일 실행 잠금, 미확정 상태 |
| 가격 또는 자격 변경 | 의도하지 않은 요청 | 실행 직전 가격 0과 수령 가능 상태 재조회 |
| serverless 실행 제한 | 수령 상태 유실 | 짧은 요청 단위 설계와 DB 상태 머신 적용 |

## 승인 전 확인이 필요한 사항

1. 한국 기준 오전 9시가 실제 `Free Legendary Token` 갱신 시각인지 연동 조사 단계에서 검증이 필요합니다.
2. Google 계정 로그인 후 DomiNations World Web Store에서 연결된 게임 계정 3개를 선택해 각각 수령할 수 있는지 확인이 필요합니다.
3. 사용할 Vercel 계정의 plan(Hobby/Pro/Enterprise), team/project와 배포 권한 확인이 필요합니다.
4. Git 호스팅 종류, 저장소 URL, milestone 번호 체계가 필요합니다.
5. 프로젝트 런타임, 프레임워크, 언어, 패키지 매니저와 테스트 도구는 아직 결정되지 않았습니다.

## Preview 승인 시 다음 단계

preview 승인 내용을 문서에 반영한 뒤, 승인된 범위만 기준으로 Git milestone과 issue 후보를 등록합니다. 그 전에는 애플리케이션 생성, 소스 코드 수정, 테스트, 로그인 시도, 무료 아이템 수령 시도 또는 Vercel 배포를 수행하지 않습니다.

---

## 승인 이력

| 구분 | 승인 일자 |
| --- | --- |
| Preview | 2026-08-28 |
