# Issue #4 무료 수령 안전 설계

## 상태

- 상태: 승인 완료
- 작성자: Codex
- 확인일: 2026-08-28

## 상태 변경 전 불변조건

한 항목이라도 확인되지 않으면 `/api/xsollastore/startpurchase`를 호출하지 않습니다.

1. 유효한 단일 관리자 session
2. request `Origin`과 `APP_BASE_URL` 일치
3. session 내부 값과 `X-Claim-CSRF` header 일치
4. Upstash Redis REST 설정 및 cycle batch lock 획득
5. 계정 source 두 곳에서 고유 `gameAccountId` 정확히 3개 일치
6. 상품 이름 exact `Free Legendary Token`
7. tag에 `Web Specials` 의미 포함
8. `is_free=true` 또는 numeric price `0`
9. SKU와 offer ID 모두 존재
10. disabled/locked/noInventory가 아니고 stock이 존재

## 갱신 cycle

- timezone: `Asia/Seoul` 고정 UTC+9, DST 없음
- reset: 매일 09:00:00 KST
- cycle ID: 해당 reset 날짜의 `YYYY-MM-DD`
- 08:59:59 KST는 전날 cycle, 09:00:00 KST부터 당일 cycle
- ledger TTL: cycle 종료 뒤 24시간까지 보존

## Redis key

key에는 관리자 subject, full gameAccountId, SKU를 평문으로 넣지 않습니다. SHA-256 digest 일부만 사용합니다.

| key | 목적 | TTL |
| --- | --- | --- |
| `domi:claim:batch:{cycle}:{adminHash}` | 같은 관리자 batch 동시 실행 방지 | 180초 |
| `domi:claim:account:{cycle}:{accountHash}` | 계정 단위 실행 lock | 120초 |
| `domi:claim:ledger:{cycle}:{accountHash}` | 결과·idempotency | cycle 종료 + 24시간 |

lock은 `SET key owner NX EX ttl`로 획득합니다. 정상 종료 시 Lua script가 저장된 owner와 요청 owner가 같을 때만 `DEL`합니다. Redis 장애·미설정은 claim을 중단합니다.

## 공식 수령 요청

공개 Web Store client에서 확인한 body 의미를 그대로 제한합니다.

```json
{
  "gameAccountId": "server-only",
  "itemSku": "fresh-product-sku",
  "offerId": "fresh-product-offer",
  "quantity": 1,
  "locale": "en-US",
  "returnToken": true,
  "targetUserHash": "",
  "domgl": false,
  "anonymize": false,
  "projectId": 277239
}
```

응답 `orderAccessToken`이 exact 문자열 `free`일 때만 결제 없는 무료 수령 응답으로 취급합니다. 다른 token은 외부 checkout 가능성이 있으므로 저장·반환·이동하지 않고 `ineligible`로 차단합니다.

## 결과 확인

- `free` 후 product를 다시 조회합니다.
- stock 감소, cooldown/claimed 전환, 또는 availability 소진이 확인되면 `success`입니다.
- 응답은 `free`였지만 상태 변화가 확인되지 않으면 `uncertain`입니다.
- 상태 변경 요청 이후 timeout/network/schema 오류도 `uncertain` ledger로 남깁니다.
- `uncertain`은 운영자가 Web Store에서 직접 확인하기 전 재시도하지 않습니다.

## 공개 응답

- cycle ID, 시작·종료 시각
- 계정 name과 마스킹 ID
- `success | already_claimed | duplicate | ineligible | failed | uncertain`
- 민감하지 않은 안정적 reason code

raw DomiNations/Xsolla token, cookie, full account ID, SKU, offer ID, Redis URL/token, upstream body는 반환·로그하지 않습니다.

## 필요한 환경 변수

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN` (read/write token)

두 값은 Vercel Marketplace Upstash integration 또는 Upstash console에서 주입합니다. read-only token은 lock/ledger에 사용할 수 없습니다. 실제 Vercel 연결은 배포 승인 이후 진행합니다.
