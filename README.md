# Domination Dashboard

Google 계정에 연결된 DomiNations 게임 계정 3개의 일일 무료 아이템 수령을 한 화면에서 관리하기 위한 Next.js 대시보드입니다.

현재 Issue #2 범위에서는 애플리케이션 기반과 Vercel 미국 `iad1` Function 진단만 구현되어 있습니다. 로그인, 계정 조회, 상품 조회와 수령은 아직 활성화되지 않았습니다.

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

실제 Vercel 배포는 작업지시자의 별도 승인을 받은 뒤 진행합니다.
