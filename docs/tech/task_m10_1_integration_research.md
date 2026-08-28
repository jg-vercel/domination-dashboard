# M1.0 Issue #1 DomiNations World 연동 적격성 조사

## 상태

- 상태: 완료
- 작성자: Codex
- 조사일: 2026-08-28
- 범위: Google 로그인, 게임 계정 3개, `Web Specials > Free Legendary Token`, 미국 Vercel 리전 기반 수령 흐름
- 결론: 조건부 구현 가능

## 결론 요약

승인된 대시보드 구조는 기술적으로 구현 가능한 경로가 있습니다.

1. 대시보드의 Google OAuth에서 받은 Google access token을 Xsolla Login의 공식 social access token 인증 방식으로 교환합니다.
2. 교환된 Xsolla JWT를 DomiNations World의 공개 웹 클라이언트와 같은 PKCE 로그인 흐름에 전달해 DomiNations World token과 session cookie를 얻습니다.
3. DomiNations World API에서 연결된 `gameAccountId` 목록과 계정 정보를 조회합니다.
4. 각 게임 계정별 상품 목록에서 `Free Legendary Token`의 가격 0, `is_free`, 재고 및 수령 가능 상태를 다시 확인합니다.
5. 작업지시자의 버튼 입력이 있을 때만 계정별 공식 무료 구매 요청을 순차 전송합니다.
6. 응답의 `orderAccessToken`이 `free`인 경우에만 무료 수령 성공으로 처리하고 상품 상태를 재조회합니다.

다만 다음 항목은 인증된 사용자 session 또는 Vercel 환경이 있어야 최종 검증할 수 있습니다.

- DomiNations World의 Xsolla project가 대시보드 Google OAuth access token을 정상 수락하는지
- 실제 연결된 게임 계정 3개가 모두 동일 session에서 조회되는지
- `Free Legendary Token`의 실제 SKU, offer ID, 가격 0, 갱신 상태와 한국 오전 9시 기준
- Vercel `iad1` 요청에서 국가 코드가 미국으로 판정되고 `asia=false`가 되는지
- 제3자 대시보드의 공식 client API 사용이 운영사 정책상 허용되는지

## 확인된 시스템 구조

### 서비스와 공개 설정

로그인 전 Web Store HTML에서 다음 구성이 확인됩니다.

| 항목 | 값 |
| --- | --- |
| Web Store | `https://www.dominationsworld.com/web-store` |
| API/Auth host | `https://api.dominationsworld.com` |
| Xsolla Login project | `8fa0bdc4-6ab1-47e2-91dc-731b88e3607f` |
| Web Store project ID | `277239` |
| DomiNations WebGL Store project ID | `228334` |
| Google OAuth callback | `https://dominationsworld.com/login` |

DomiNations World의 Google 로그인 버튼은 Xsolla Login의 Google social redirect를 사용합니다. Xsolla는 Google OAuth 완료 후 callback URL에 JWT token을 전달하며, DomiNations World 공개 script는 `/login?token=...`의 token을 읽어 자체 로그인 흐름으로 교환합니다.

### Google/Xsolla 인증

#### 확인됨

- 공식 사이트는 Google 비밀번호를 직접 받지 않고 Xsolla social login redirect를 사용합니다.
- Xsolla 공식 문서는 Google access token을 `/social/google/login_with_token` 방식으로 사용자 JWT로 교환할 수 있다고 설명합니다.
- redirect 방식의 `login_url`은 Xsolla Publisher Account에 등록된 callback URL과 일치해야 합니다.
- 현재 project의 callback은 DomiNations World 도메인이므로, 대시보드 도메인이 공식 redirect token을 직접 받는 방식은 사용할 수 없습니다.

#### 구현 후보

대시보드가 자체 Google OAuth client로 사용자 동의를 받고 서버에서 Google access token을 확보한 다음, Xsolla의 공식 access-token login 방식을 호출하는 후보가 있습니다. 이 방법은 Google 비밀번호나 DomiNations 비밀번호를 저장하지 않습니다.

응답 token은 DomiNations World 공개 client와 동일하게 DomiNations World 로그인 교환에 사용합니다. 실제 project에서 이 방식이 활성화되어 있는지는 실계정 검증이 필요합니다.

#### session 보안 결정

- Google 비밀번호를 수집하거나 저장하지 않습니다.
- Google access token, Xsolla JWT, DomiNations token과 cookie를 브라우저 JavaScript에 반환하지 않습니다.
- token과 cookie는 서버 측 암호화 session에만 저장합니다.
- 로그에는 token, cookie, authorization header, callback query를 남기지 않습니다.
- session 만료 시 자동 우회하지 않고 Google 재로그인을 요구합니다.

### DomiNations World token 교환

공개 client는 social JWT를 DomiNations World 계정 로그인 요청에 전달하면서 PKCE `codeChallenge`를 생성합니다. 서버가 반환한 authorization code를 `code_verifier`와 함께 token endpoint로 교환합니다.

교환 결과에는 DomiNations World API의 `Authorization: Bearer`에 사용할 token과 session 유지에 필요한 cookie가 포함될 수 있습니다. 따라서 Vercel Function에서는 요청 간 cookie jar 또는 암호화된 session cookie/저장소가 필요합니다.

공개 client가 token과 로그인 요청 body를 console에 출력하는 코드가 관찰되지만, 대시보드에서는 이를 재현하지 않고 모든 민감 로그를 제거해야 합니다.

### 게임 계정 3개 식별

공개 client는 DomiNations game key `dom`에 대해 계정 목록을 요청하고 응답의 `gameIds`를 `gameAccountId` 기준으로 관리합니다. 추가로 linked user info 응답에서 다음 정보를 사용합니다.

- `gameAccountId`
- 게임 계정 이름
- Age
- 트로피 및 일부 진행 정보

대시보드는 표시 이름이 중복되거나 바뀔 수 있으므로 `gameAccountId`를 내부 기본 키로 사용해야 합니다. 사용자에게는 게임 계정 이름과 Age를 함께 표시합니다.

실제 계정 수가 3개가 아니면 자동으로 임의 계정을 처리하지 않고 설정 오류로 표시합니다.

### Web Store 상품 조회

Web Store의 `WEB SPECIALS` 영역은 공개 content에서 확인되며 Store project ID `277239`를 사용합니다.

상품 목록 요청은 `gameAccountId`, project ID, locale을 사용하며 다음 필드를 제공합니다.

- 상품명과 설명
- `google` 필드의 item SKU
- `offerId`
- 가격과 통화
- `is_free`
- `stockAvailable`, `stockMax`
- `noInventory`, `disabled`, `locked`
- `refresh`, `validUntil`
- `tags`

로그인되지 않은 빈 `gameAccountId`로 상품 목록을 조회하면 일반 상품 일부만 비활성 상태로 반환되었고 `Free Legendary Token`은 노출되지 않았습니다. 정확한 무료 아이템 정보는 인증된 각 게임 계정으로 조회해야 합니다.

수령 대상 판정 조건은 다음을 모두 만족하도록 제한합니다.

1. 상품명이 `Free Legendary Token`과 일치합니다.
2. `WEB SPECIALS`를 구성하는 tag/section에 속합니다.
3. `is_free=true` 또는 서버 가격이 0입니다.
4. `disabled=false`, `locked=false`입니다.
5. `stockAvailable > 0`이고 이미 수령한 상태가 아닙니다.
6. SKU와 offer ID가 서버의 최신 상품 조회 결과에 존재합니다.

조건 하나라도 만족하지 않으면 수령 요청을 보내지 않습니다.

### 무료 수령 요청

공개 client의 무료 상품도 유료 상품과 같은 purchase 시작 endpoint를 사용하지만, 서버가 `orderAccessToken="free"`를 반환하면 Xsolla 결제창을 열지 않고 성공으로 처리합니다.

요청에는 다음 의미의 값이 포함됩니다.

- 대상 `gameAccountId`
- item SKU
- offer ID
- 수량 1
- locale
- Store project ID
- 결제 token 반환 요청 여부

대시보드는 세 게임 계정을 순차 처리하며 각 계정 직전에 상품 목록을 다시 조회해야 합니다. 응답이 `free`가 아니면 유료 또는 예상하지 못한 흐름으로 판단하고 즉시 중단합니다.

### 지역 판정

공개 client는 국가 판정 endpoint 응답의 `asia` 값을 확인하고 `asia=true`이면 Web Store purchase 진입을 차단합니다.

2026-08-28 한국 네트워크에서 읽기 전용 국가 판정 요청을 실행한 결과:

```json
{"countryCode":"KR","asia":true,"apiEnabled":true}
```

이 결과는 지역 판정이 적어도 요청 출발 IP의 영향을 받는다는 강한 근거입니다. Vercel Node.js Function을 `iad1`에 고정하면 API가 미국 IP로 관찰할 가능성이 높지만, 실제 결과는 Vercel 배포 후 국가 판정 endpoint에서 `US`, `asia=false`를 확인해야 확정할 수 있습니다.

Vercel의 정적 CDN 위치와 Function 실행 리전은 별개이므로 수령 요청은 반드시 `iad1` Node.js Function에서 전송합니다.

## 오전 9시 갱신 처리

공개 client는 상품의 `refresh`, `validUntil`, 재고 값을 사용해 남은 시간을 표시합니다. 공개 로그인 전 상태만으로 한국 오전 9시 갱신을 확정할 수는 없습니다.

구현에서는 다음 원칙을 사용합니다.

- 화면의 예상 갱신 시각은 `Asia/Seoul 09:00`으로 표시합니다.
- 실제 수령 가능 여부는 서버가 반환한 최신 상품 재고와 refresh 상태를 최종 기준으로 사용합니다.
- 오전 9시 전후의 경계에서는 상품 목록을 새로 조회합니다.
- 로컬 idempotency key는 `갱신 주기 + gameAccountId + itemSku` 조합을 사용합니다.
- 서버가 이미 수령 상태를 반환하면 로컬 기록과 무관하게 건너뜁니다.

## 구현 경계

### 대시보드가 담당

- 단일 관리자 Google 로그인
- Google access token의 서버 측 Xsolla 교환
- DomiNations World token/cookie의 암호화 session 보관
- 게임 계정 3개 조회 및 선택 검증
- 계정별 상품 재조회
- 가격 0과 수령 자격 검증
- 사용자 버튼 입력에 따른 순차 수령
- 중복 실행 잠금, 결과 상태 및 민감정보 없는 감사 로그

### 대시보드가 하지 않음

- Google 또는 DomiNations 비밀번호 저장
- 브라우저 localStorage/cookie 탈취 또는 token 붙여넣기 요구
- CAPTCHA나 지역 판정 우회
- headless browser로 공식 사이트 버튼 자동 조작
- 유료 item 처리
- 예약·무인 수령
- 계정별 하루 1회 제한 우회

## 정책 및 계정 위험

DomiNations World 이용약관은 승인되지 않은 bot과 제3자 자동화 소프트웨어 사용을 제한합니다. 이번 요구사항은 작업지시자가 버튼을 직접 누르고, 게임 플레이가 아닌 무료 Web Store item을 공식 client 요청 경계로 수령하는 구조이므로 무인 bot보다 범위가 제한적입니다.

그러나 Big Huge Games가 제3자 대시보드의 API 사용을 명시적으로 허용한 근거는 확인되지 않았습니다. 계정 제한 위험을 완전히 제거하려면 운영사 확인이 필요합니다. 대상 API가 차단되거나 정책상 허용되지 않는 것으로 확인되면 구현을 우회 방식으로 확대하지 않습니다.

## 사실·추론·미확인 구분

| 항목 | 판정 | 근거 또는 다음 검증 |
| --- | --- | --- |
| Google 로그인은 Xsolla social login 사용 | 확인됨 | 공개 Web Store HTML과 Xsolla redirect |
| 자체 callback URL로 공식 redirect token 수신 | 불가 | callback은 Publisher Account 등록 URL과 일치해야 함 |
| Google access token을 Xsolla JWT로 교환 | 공식 지원 확인 | Xsolla Login 공식 문서 |
| 해당 DomiNations project에서 자체 Google OAuth token 수락 | 미확인 | Google OAuth credential과 실계정 검증 필요 |
| 게임 계정은 `gameAccountId`로 개별 조회 | 확인됨 | 공개 client의 계정 목록·linked user info 흐름 |
| 실제 게임 계정이 3개 모두 반환됨 | 미확인 | 인증 session 검증 필요 |
| Web Store project ID가 277239 | 확인됨 | 공개 Web Store HTML과 client 설정 |
| 무료 item은 purchase 응답 `free`로 완료 | 확인됨 | 공개 client의 무료 처리 분기 |
| 정확한 item SKU와 offer ID | 미확인 | 인증된 계정별 상품 조회 필요 |
| 한국 오전 9시 갱신 | 사용자 정보, 미확인 | 상품 refresh/stock의 경계 관찰 필요 |
| 현재 한국 요청은 `KR`, `asia=true` | 확인됨 | 2026-08-28 읽기 전용 API 응답 |
| Vercel `iad1`은 `US`, `asia=false` | 높은 가능성, 미확인 | 배포 후 Function에서 검증 필요 |
| 제3자 대시보드 API 사용 허용 | 미확인 | 운영사 정책 확인 필요 |

## 후속 이슈 권고

### Issue #2 진행 가능

신규 대시보드 scaffold, `iad1` 설정, 지역 확인 API, secret redaction 및 mock 기반 구조는 인증 credential 없이 구현할 수 있습니다.

### Issue #3 진행 조건

- 작업지시자가 소유한 Google Cloud OAuth client ID와 secret
- 로컬 callback URL 등록
- 운영 Vercel callback URL은 배포 승인 이후 등록
- Xsolla `login_with_token`과 DomiNations token 교환의 실계정 검증

credential은 문서나 Git에 기록하지 않고 로컬 `.env.local`과 Vercel secret에만 보관해야 합니다.

### Issue #4 진행 조건

- Issue #3에서 게임 계정 3개와 인증 session 확인
- 계정별 `Free Legendary Token` SKU, offer ID, 가격 0과 stock 상태 확인
- 운영사 정책 위험 수용 또는 허용 확인

실계정 검증 전에는 mock adapter와 요청 차단 상태로 구현해야 합니다.

## 참고 자료

- [DomiNations World Web Store](https://www.dominationsworld.com/web-store)
- [DomiNations World Web Store content](https://www.dominationsworld.com/webstorecontent/)
- [DomiNations World 이용약관](https://www.dominationsworld.com/terms-of-use)
- [Xsolla: JWT social network authentication](https://developers.xsolla.com/api/login/operation/jwt-auth-via-social-network/)
- [Xsolla: social access token authentication](https://developers.xsolla.com/api/login/social-login/jwt-auth-via-access-token-of-social-network)
- [Vercel Function 리전 설정](https://vercel.com/docs/functions/configuring-functions/region)
- [Vercel outbound IP 안내](https://vercel.com/kb/guide/how-to-allowlist-deployment-ip-address)

## 재현한 읽기 전용 확인

```bash
curl -sSL https://www.dominationsworld.com/web-store
curl -sSL https://www.dominationsworld.com/webstorecontent/
curl -sS https://api.dominationsworld.com/api/gameident/getplayercountry
```

인증 token, cookie 또는 상태 변경 요청은 조사 과정에서 사용하지 않았습니다.
