# Domination Dashboard

Google 계정에 연결된 DomiNations 게임 계정 3개의 일일 무료 아이템 수령을 한 화면에서 관리하기 위한 Next.js 대시보드입니다.

현재 미국 `iad1` Function 진단, Google OAuth 보안 흐름, Xsolla/DomiNations session 교환, 게임 계정 3개와 계정별 무료 상품 상태 조회, 사용자 버튼 기반 3계정 순차 무료 수령 로직이 구현되어 있습니다. 로그인·exact 상품 검증·Upstash lock 조건을 모두 만족한 경우에만 수령 버튼이 활성화됩니다.

## 로컬 실행

요구사항은 Node.js `24.x`와 pnpm `11.24.0`입니다.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`http://localhost:3000`에서 대시보드를 열고 **환경 진단 실행**을 누르면 다음 읽기 전용 API를 확인합니다.

- `/api/health`
- `/api/system/region`
- `/api/system/outbound-country`

로컬 outbound는 개발자 네트워크를 사용하므로 한국에서 실행하면 `KR`로 표시되는 것이 정상입니다. Vercel Preview에서 `runtimeRegion=iad1`, `countryCode=US`, `asia=false`인지 별도로 확인해야 합니다.

## 검증

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

## 환경 변수와 secret

- 로컬 secret은 Git에서 제외된 `.env.local`에만 둡니다.
- 운영 secret은 Vercel Environment Variables에만 저장합니다.
- OAuth token, cookie, DomiNations session은 `NEXT_PUBLIC_` 변수에 넣지 않습니다.
- `.env.example`에는 변수 이름과 안전한 예시만 기록하며 실제 값은 커밋하지 않습니다.

### Google OAuth 로컬 설정

Google Cloud에서 Web application OAuth client를 만들고 다음 redirect URI를 등록합니다.

```text
http://localhost:3000/api/auth/google/callback
```

`.env.example`을 참고해 `.env.local`에 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_SESSION_SECRET`을 설정합니다. 실제 값은 GitHub, 문서, 채팅에 기록하지 않습니다. 운영 `APP_BASE_URL`과 redirect URI는 Vercel URL이 확정된 뒤 별도로 설정합니다.

Google 로그인은 비밀번호를 받지 않으며 PKCE/state/nonce와 Google ID token 검증을 통과해야 합니다. 로그인한 Google subject가 자신의 session 소유자가 되며 고정 관리자 이메일은 사용하지 않습니다. Google access token과 Xsolla JWT는 DomiNations session 교환 후 즉시 폐기됩니다.

### 중복 방지 저장소

Vercel Marketplace에서 Upstash Redis를 연결한 뒤 `UPSTASH_REDIS_REST_URL`과 read/write `UPSTASH_REDIS_REST_TOKEN`을 주입합니다. Google refresh token과 DomiNations credential은 AES-256-GCM으로 봉인된 server-side session에만 저장되고, browser에는 opaque HttpOnly cookie만 남습니다. session은 정상 활동마다 180일 idle TTL을 연장하며 Google 권한 취소·만료 시 재로그인을 요구합니다. Redis가 없거나 응답하지 않으면 인증과 실제 수령 endpoint는 fail-closed됩니다.

수령은 매일 09:00 KST cycle 단위로 잠금·기록됩니다. exact `Web Specials > Free Legendary Token`, 무료 가격, SKU, offer, stock을 요청 직전에 다시 확인하고 `orderAccessToken`이 `free`가 아니면 외부 checkout을 열지 않습니다.

실제 Vercel 배포는 작업지시자의 별도 승인을 받은 뒤 진행합니다.

### 로그인 상태 유지와 설정 안내

사용자는 `Google로 로그인`을 통해 인증하며 로그인 정보를 환경변수에 입력하지 않습니다. OAuth Client ID/Secret은 앱 식별용 서버 설정이고, `APP_SESSION_SECRET`은 저장된 세션의 암호화 키입니다. 배포마다 이 키를 임의로 교체하면 기존 세션을 읽을 수 없습니다.

서버 세션은 마지막 정상 활동에서 180일, 브라우저 HttpOnly cookie는 갱신 시점에서 400일 유지됩니다. 화면이 표시될 때와 표시 중 1시간 간격, 탭·온라인 복귀 시 세션을 갱신합니다. 이벤트 갱신은 5분 간격으로 제한하며 숨겨진 탭은 갱신하지 않습니다. Google 권한 취소, cookie 삭제, 저장소 데이터 삭제 또는 180일 미접속 후에는 재로그인이 필요할 수 있습니다.

- `Google 로그인 준비 중`: 앱의 OAuth·세션 암호화 설정을 관리자가 확인해야 합니다.
- `로그인 저장소 준비 중`: 관리자가 Redis 연결 설정을 확인해야 합니다.
- `로그인 상태 확인 지연`: 일시적인 서버·저장소 오류일 수 있으므로 새로고침합니다. 이 오류만으로 cookie를 삭제하지 않습니다.
- `Google로 로그인`: 로그인하지 않았거나 세션이 만료되어 인증이 필요합니다.

Vercel Preview와 Production의 환경변수·도메인·cookie는 별개입니다. 한 환경의 설정이나 로그인은 다른 환경의 로그인을 보장하지 않습니다. 운영자는 실제 접속 환경에 OAuth/Redis 설정과 고정 암호화 키를 적용하고 해당 도메인의 `APP_BASE_URL` 및 Google redirect URI를 일치시켜야 합니다. 이번 보완의 범위와 검증 결과는 `docs/report/task_m10_6_report_v2.md`에 기록합니다.
