# M1.0 Vercel 배포 체크리스트

## 상태

- 상태: Preview 인프라 배포·검증 완료, Issue #6 장기 session 재배포와 Google OAuth·실계정 수용 검증 대기
- 작성자: Codex
- 작성일: 2026-08-28
- 실행일: 2026-08-31
- 배포 대상: Vercel Node.js `24.x`, Function region `iad1`
- 확인한 Vercel CLI 버전: `59.9.1`
- Vercel CLI 인증 상태: `mintmd95-4401` 로그인 완료

## 승인 경계

작업지시자는 2026-08-31 Vercel Preview 배포를 승인했습니다. 승인에 따라 project 연결, Preview 배포, 무료 Upstash 연결, 자동 생성 가능한 Preview 환경 변수를 설정했습니다.

Google Cloud OAuth client 생성·비밀값 입력, 실계정 로그인, 실제 무료 item 수령, Production 설정·재배포는 이 승인으로 수행하지 않습니다.

Vercel CLI는 새 project의 첫 `vercel deploy --yes`를 자동으로 Production target에 지정했습니다. 명령에 `--prod`는 사용하지 않았습니다. 해당 최초 배포에는 앱 환경 변수가 없으므로 인증과 수령 endpoint가 fail-closed이며, 이후 별도 Preview를 생성해 검증했습니다.

## 1. 사전 준비

- 작업지시자의 device login으로 Vercel CLI 인증을 완료했습니다.
- GitHub branch `local/task5`의 release 검증 결과를 확인합니다.
- Vercel account/team은 `mintmd95-4401s-projects`로 확인했습니다.
- Google Cloud Web OAuth client의 소유권과 consent screen 상태를 확인합니다.
- Upstash Redis의 read/write REST token을 사용할 수 있는지 확인합니다.
- DomiNations World 제3자 dashboard 사용에 대한 정책 위험을 작업지시자가 수용했는지 확인합니다.

## 2. Vercel project 설정

| 항목 | 기대값 |
| --- | --- |
| Framework Preset | Next.js |
| Root Directory | repository root |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm build` |
| Node.js Version | `24.x` |
| Function Region | `iad1` (`vercel.json`) |
| Production Branch | 작업지시자가 승인한 branch |

실제 project는 `mintmd95-4401s-projects/domination-dashboard`이며 GitHub `jg-vercel/domination-dashboard`에 연결됐습니다. Vercel project inspect 결과 Node.js `24.x`, Sandbox region `iad1`, Framework Preset `Next.js`입니다.

Git 연결만으로 자동 Production 배포가 시작되지 않도록 Production branch와 자동 배포 설정을 먼저 확인합니다.

## 3. Upstash 연결

1. Vercel Marketplace에서 Upstash Redis를 project에 연결했습니다.
2. `domination-dashboard-redis`를 `iad1`, Free, `autoUpgrade=false`, `prodPack=false`로 만들고 Preview에만 연결했습니다.
3. read-only token을 `UPSTASH_REDIS_REST_TOKEN`에 사용하지 않습니다.
4. secret 값을 문서·GitHub issue·deployment log에 출력하지 않습니다.
5. Marketplace read/write token을 앱 변수에 매핑한 뒤 REST `PING`의 `PONG` 응답을 확인했습니다.

## 4. 환경 변수

| 이름 | Preview | Production | 민감 |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | 입력 대기 | 미설정 | 제한 정보 |
| `GOOGLE_CLIENT_SECRET` | 입력 대기 | 미설정 | 예 |
| `APP_SESSION_SECRET` | 설정 완료 | 미설정 | 예, 최소 32자 |
| `APP_BASE_URL` | `https://domination-dashboard-preview.vercel.app` | 미설정 | 아니오 |
| `UPSTASH_REDIS_REST_URL` | 설정 완료 | 미설정 | 제한 정보 |
| `UPSTASH_REDIS_REST_TOKEN` | 설정 완료 | 미설정 | 예 |

Preview와 Production의 `APP_SESSION_SECRET`은 서로 다른 값을 권장합니다. 실제 값은 Vercel UI/CLI의 secret input으로만 입력합니다.

## 5. Google redirect URI

Preview 고정 별칭이 확정됐으므로 다음 URI를 Google Cloud OAuth client의 Authorized redirect URIs에 등록합니다.

```text
https://domination-dashboard-preview.vercel.app/api/auth/google/callback
```

Production custom domain 또는 Vercel domain이 확정되면 해당 callback도 별도로 등록합니다. `APP_BASE_URL`과 redirect URI의 origin이 정확히 같아야 합니다.

## 6. Preview 수용 검증

아래 순서에서 상태 변경은 마지막 단계의 사용자 버튼 1회뿐입니다.

1. `/api/health`가 `200`, `no-store`인지 확인합니다.
2. `/api/system/region`이 `runtimeRegion=iad1`, `platform=vercel`인지 확인합니다.
3. `/api/system/outbound-country`가 `countryCode=US`, `asia=false`, `targetMet=true`인지 확인합니다.
4. 비로그인 dashboard에서 계정·수령 버튼이 차단되는지 확인합니다.
5. 로그인한 Google subject가 자신의 server session과 audit namespace를 사용하는지 확인합니다.
6. Google 계정으로 로그인하고 게임 계정 3개의 name/마스킹 ID가 서로 다른지 확인합니다.
7. 세 계정 모두 exact `Free Legendary Token`, Web Specials, free, SKU/offer, stock 상태가 확인되는지 검토합니다.
8. 실제 수령 전 dashboard와 공식 Web Store를 나란히 확인합니다.
9. 작업지시자가 dashboard 버튼을 1회 누릅니다.
10. 계정별 결과, 감사 기록, 공식 Web Store stock/cooldown을 확인합니다.
11. 같은 cycle에 다시 누르면 성공 계정이 `duplicate`로 skip되는지 확인합니다.

현재 결과:

| 항목 | 결과 |
| --- | --- |
| Preview deployment | Ready, target `preview`, Vercel Authentication 보호 |
| `/api/health` | `200`, `no-store` |
| `/api/system/region` | `runtimeRegion=iad1`, `platform=vercel`, `regionMatches=true` |
| `/api/system/outbound-country` | `countryCode=US`, `asia=false`, `targetMet=true` |
| Upstash | Free Preview resource, `PING -> PONG` |
| Google 미설정 경로 | `/api/auth/google/start`가 `503 AUTH_NOT_CONFIGURED`, `no-store` |
| 실계정·실수령 | 미실행 |

Issue #6 재배포 후에는 refresh token 필수 수신, opaque cookie, 180일 Redis rolling TTL, dashboard keep-alive, logout Redis 삭제를 추가로 확인합니다.

## 7. Production 전환

- Preview 수용 기준과 미확정 결과가 모두 정리되어야 합니다.
- `uncertain` 계정이 있으면 공식 Web Store에서 직접 확인하기 전 재시도하지 않습니다.
- secret rotation과 Google callback 변경 후 Preview를 다시 검증합니다.
- 작업지시자의 Production 배포 승인을 별도로 받습니다.
- 최초 자동 Production deployment는 환경 변수가 없는 안전한 상태로 유지하며, 추가 Production 작업으로 간주하지 않습니다.
