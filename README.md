# 가계부 Pro — 프론트엔드 (expense_frontend)

개인 지출/수입을 기록·분석하고 예산·구독·AI 조언까지 제공하는 **가계부 웹앱의 프론트엔드**입니다.
Next.js(App Router) 기반이며, 백엔드(FastAPI)와 연동해 동작합니다.

- 프레임워크: **Next.js 16 (App Router) + React 19 + TypeScript**
- 서버 상태: **TanStack Query (React Query)**
- 차트: **Chart.js + react-chartjs-2**
- 스타일: **Tailwind CSS 4**
- 기타: `@dnd-kit`(드래그 정렬), `react-markdown`(AI 조언 렌더)
- 백엔드: 상위 폴더 `../` = `expense_tracker` 루트 (FastAPI, 포트 **5000**). 이 프론트는 모노레포의 `frontend/`
- 통신: 동일 출처 상대경로 호출 → `next.config.ts` rewrites가 백엔드(5000)로 프록시 (CORS 불필요)

---

## 목차
- [주요 기능](#주요-기능)
- [기술 스택](#기술-스택)
- [시작하기](#시작하기)
- [백엔드 연동](#백엔드-연동)
- [스크립트](#스크립트)
- [프로젝트 구조](#프로젝트-구조)
- [인증 방식](#인증-방식)

---

## 주요 기능

페이지(라우트)별로 정리한 기능입니다.

| 경로 | 화면 | 설명 |
|---|---|---|
| `/login`, `/register` | 로그인 / 회원가입 | 계정 인증 |
| `/dashboard` | 대시보드 | 잔액·수입·지출 요약, 핵심 지표 |
| `/transactions` | 거래 내역 | 거래 목록·필터·편집 |
| `/record` | 빠른 기록 | 수입/지출 빠른 입력 |
| `/analytics` | 분석 | 카테고리·결제수단·월별 차트 분석 |
| `/report` | 리포트 | 기간별 리포트 |
| `/budget` | 예산 | 카테고리별 예산 설정/추적 |
| `/categories` | 카테고리 | 카테고리 관리(드래그 정렬) |
| `/subscriptions` | 구독/정기결제 | 반복 거래(구독) 관리 |
| `/search` | 검색 | 거래 검색 |
| `/ai-advisor` | AI 조언 | 지출 패턴 기반 AI 조언(마크다운 렌더) |

---

## 기술 스택

**런타임/프레임워크**
- Next.js `16.2.7` (App Router)
- React `19.2.4` / React DOM `19.2.4`
- TypeScript `5`

**데이터/상태**
- `@tanstack/react-query` `5` — 서버 상태·캐싱·뮤테이션

**UI/시각화**
- Tailwind CSS `4` (`@tailwindcss/postcss`)
- `chart.js` `4` + `react-chartjs-2` `5`
- `@dnd-kit/core`·`sortable`·`utilities` — 드래그 앤 드롭 정렬
- `react-markdown` `9` — AI 조언 텍스트 렌더링

**도구**
- ESLint `9` (`eslint-config-next`)

---

## 시작하기

### 사전 요구사항
- Node.js 18+ (권장: LTS)
- 백엔드(`../expense_tracker`)가 포트 5000에서 실행 중이어야 데이터 연동됨

### 설치
```bash
npm install
```

### 개발 서버 실행
```bash
npm run dev
```
브라우저에서 [http://localhost:3000](http://localhost:3000) 접속.

### 프론트 + 백엔드 한 번에 실행 (Windows)
모노레포 루트(`../`)의 편의 스크립트를 실행하세요.
```bat
..\start_all.bat
```
- 백엔드(`expense_tracker` 루트)를 포트 **5000**, 프론트(`frontend`)를 포트 **3000**으로 각각 새 창에서 실행
- `frontend\node_modules`가 없으면 자동으로 `npm install` 후 `npm run dev`
- 잠시 후 브라우저에서 `http://localhost:3000`을 자동으로 엽니다

---

## 백엔드 연동

동일 출처 **상대경로**로 호출하고, `next.config.ts`의 rewrites가 백엔드(5000)로 프록시합니다.

```ts
// lib/api.ts — 상대경로(빈 base). rewrites가 프록시하므로 절대 URL·CORS 불필요.
export const API_BASE = '';
```
```ts
// next.config.ts — /auth /transaction /ai /health → http://127.0.0.1:5000
```

- 모든 요청은 `credentials: 'include'`로 **쿠키 기반 인증**을 사용합니다(동일 출처라 세션 쿠키 자동 전달).
- 백엔드는 상위 폴더 `expense_tracker` 루트(FastAPI)입니다.
- 백엔드 주소를 바꾸려면 `next.config.ts`의 `BACKEND`(환경변수 `BACKEND_URL`)를 수정하세요.

> 백엔드가 꺼져 있으면 프록시가 502/500을 반환합니다. 루트 `start_all.bat`으로 함께 띄우는 것을 권장합니다.

---

## 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (HMR) |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 빌드 결과 실행 |
| `npm run lint` | ESLint 검사 |

---

## 프로젝트 구조

```
expense_tracker/frontend/    # 모노레포의 프론트 (백엔드는 상위 expense_tracker 루트)
├─ app/                      # App Router 페이지
│  ├─ (app)/layout.tsx       # 로그인 후 공통 레이아웃(앱 셸)
│  ├─ layout.tsx             # 루트 레이아웃
│  ├─ page.tsx               # 진입 페이지
│  ├─ login/ register/       # 인증
│  ├─ dashboard/ transactions/ record/ search/
│  ├─ analytics/ report/ budget/ categories/
│  ├─ subscriptions/ ai-advisor/
├─ components/
│  ├─ AddTransactionModal.tsx
│  ├─ ClientLayout.tsx
│  ├─ ConfirmModal.tsx
│  ├─ layout/AppShell.tsx    # 사이드바·헤더 등 앱 셸
│  └─ providers/             # QueryProvider, ToastProvider
├─ hooks/                    # useAuth, useCategories, useSettings
├─ lib/
│  ├─ api.ts                 # API 호출 래퍼 (상대경로, API_BASE='')
│  ├─ types.ts               # 공용 타입
│  └─ utils.ts
├─ public/
├─ next.config.ts            # rewrites: /auth /transaction /ai /health → 5000
└─ (설정) next.config.ts, tsconfig.json, eslint.config.mjs, postcss.config.mjs
```

---

## 인증 방식

- 백엔드 세션 **쿠키** 기반 (`fetch` 요청에 `credentials: 'include'`)
- 로그인: `POST /auth/login` (`user_id`, `password`)
- 현재 사용자: `GET /auth/me`
- 회원가입: `POST /auth/register`
- 로그아웃: `GET /auth/logout`

인증 상태는 `hooks/useAuth.ts`에서 관리하며, 미로그인 시 로그인 페이지로 유도합니다.

---

> 이 저장소는 개인용 비공개 프로젝트입니다.
