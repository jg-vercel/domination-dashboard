# M1.0 Vercel 배포 체크리스트

## 상태

- 상태: 배포 전 준비 완료, 실제 배포 승인 대기
- 작성자: Codex
- 작성일: 2026-08-28
- 배포 대상: Vercel Node.js `24.x`, Function region `iad1`
- 확인한 Vercel CLI 버전: `59.9.1` (실행·link·deploy하지 않음)

## 승인 경계

이 문서는 배포 전 준비 절차입니다. 다음 작업은 아직 수행하지 않습니다.

- `vercel link` 또는 Vercel project 생성·연결
- Vercel Marketplace Upstash resource 생성·연결
- Vercel Environment Variables 입력
- Google Cloud 운영 redirect URI 등록
- Preview 또는 Production deploy
- 실계정 로그인·무료 item 수령

위 작업은 작업지시자의 별도 배포 승인을 받은 뒤 진행합니다.

## 1. 사전 준비

- GitHub branch `local/task5`의 release 검증 결과를 확인합니다.
- Vercel account/team과 과금 plan을 확인합니다.
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

Git 연결만으로 자동 Production 배포가 시작되지 않도록 Production branch와 자동 배포 설정을 먼저 확인합니다.

## 3. Upstash 연결

1. Vercel Marketplace에서 Upstash Redis를 project에 연결합니다.
2. read/write REST credential이 Preview와 Production에 각각 주입되는지 확인합니다.
3. read-only token을 `UPSTASH_REDIS_REST_TOKEN`에 사용하지 않습니다.
4. secret 값을 문서·GitHub issue·deployment log에 출력하지 않습니다.

## 4. 환경 변수

| 이름 | Preview | Production | 민감 |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | 필수 | 필수 | 제한 정보 |
| `GOOGLE_CLIENT_SECRET` | 필수 | 필수 | 예 |
| `ADMIN_GOOGLE_EMAIL` | 필수 | 필수 | 개인정보 |
| `APP_SESSION_SECRET` | 필수 | 필수 | 예, 최소 32자 |
| `APP_BASE_URL` | Preview URL | Production URL | 아니오 |
| `UPSTASH_REDIS_REST_URL` | 필수 | 필수 | 제한 정보 |
| `UPSTASH_REDIS_REST_TOKEN` | 필수 | 필수 | 예 |

Preview와 Production의 `APP_SESSION_SECRET`은 서로 다른 값을 권장합니다. 실제 값은 Vercel UI/CLI의 secret input으로만 입력합니다.

## 5. Google redirect URI

Preview URL이 확정된 뒤 다음 URI를 Google Cloud OAuth client의 Authorized redirect URIs에 등록합니다.

```text
https://<preview-domain>/api/auth/google/callback
```

Production custom domain 또는 Vercel domain이 확정되면 해당 callback도 별도로 등록합니다. `APP_BASE_URL`과 redirect URI의 origin이 정확히 같아야 합니다.

## 6. Preview 수용 검증

아래 순서에서 상태 변경은 마지막 단계의 사용자 버튼 1회뿐입니다.

1. `/api/health`가 `200`, `no-store`인지 확인합니다.
2. `/api/system/region`이 `runtimeRegion=iad1`, `platform=vercel`인지 확인합니다.
3. `/api/system/outbound-country`가 `countryCode=US`, `asia=false`, `targetMet=true`인지 확인합니다.
4. 비로그인 dashboard에서 계정·수령 버튼이 차단되는지 확인합니다.
5. 허용되지 않은 Google 계정이 `ADMIN_NOT_ALLOWED`로 거부되는지 확인합니다.
6. 관리자 Google 계정으로 로그인하고 게임 계정 3개의 name/마스킹 ID가 서로 다른지 확인합니다.
7. 세 계정 모두 exact `Free Legendary Token`, Web Specials, free, SKU/offer, stock 상태가 확인되는지 검토합니다.
8. 실제 수령 전 dashboard와 공식 Web Store를 나란히 확인합니다.
9. 작업지시자가 dashboard 버튼을 1회 누릅니다.
10. 계정별 결과, 감사 기록, 공식 Web Store stock/cooldown을 확인합니다.
11. 같은 cycle에 다시 누르면 성공 계정이 `duplicate`로 skip되는지 확인합니다.

## 7. Production 전환

- Preview 수용 기준과 미확정 결과가 모두 정리되어야 합니다.
- `uncertain` 계정이 있으면 공식 Web Store에서 직접 확인하기 전 재시도하지 않습니다.
- secret rotation과 Google callback 변경 후 Preview를 다시 검증합니다.
- 작업지시자의 Production 배포 승인을 별도로 받습니다.
