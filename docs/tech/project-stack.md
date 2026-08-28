# 프로젝트 개발 스택

## 상태

- 상태: 승인 완료
- 작성자: Codex
- 범위: M1.0 대시보드 MVP 개발 스택

## 변수

| 항목 | 값 |
| --- | --- |
| 프로젝트 이름 | `domination-dashboard` |
| 런타임 | Node.js `24.x` |
| 프레임워크 | Next.js `16.3.3` App Router / React `19.2.8` |
| 언어 | TypeScript `5.9.3` |
| 패키지 매니저 | pnpm `11.24.0` |
| UI/스타일링 | React Server Components 우선, CSS custom properties와 global CSS |
| 상태 관리 | React 기본 상태, 서버 상태는 Route Handler 경계에서 관리 |
| 데이터 계층 | Issue #2에서는 영속 저장소 없음. 후속 이슈에서 server-only adapter 추가 |
| 인증 | Issue #3에서 Google OAuth 공식 흐름으로 확정 |
| 테스트 도구 | Vitest `4.1.11`, React Testing Library `16.3.3`, jsdom `30.0.1` |
| 린트/포맷 | ESLint `9.39.5`, `eslint-config-next` `16.3.3`, TypeScript `noEmit` |
| 배포 환경 | Vercel Node.js Functions, 단일 미국 리전 `iad1` |

## 결정사항

- 작업지시자가 `Next.js + TypeScript + pnpm` 조합을 승인했습니다.
- Vercel이 지원하는 최신 LTS 기본값에 맞춰 Node.js `24.x`를 명시합니다.
- 수령과 외부 요청은 Edge가 아닌 Node.js Route Handler로 실행하고 `vercel.json`에서 `iad1`을 고정합니다.
- secret은 브라우저 번들·저장소에 포함하지 않고 `.env.local` 또는 Vercel Environment Variables로만 주입합니다.
- Google 인증, session 저장소, DomiNations adapter의 세부 선택은 각 후속 이슈에서 확정합니다.

## 열린 질문

- 장기 session을 암호화해 저장할 데이터 계층은 Issue #3에서 결정합니다.
- 실제 `iad1` 실행 및 미국 outbound 판정은 Vercel Preview 배포 후 검증합니다.
