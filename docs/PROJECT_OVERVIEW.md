# YourPark 프로젝트 개요 문서

> 이 문서는 외부 LLM(GPT, Gemini 등)이 이 프로젝트를 빠르게 이해할 수 있도록 작성된 설명 문서입니다.

---

## 서비스 이름

**YourPark** (내부 코드명: `yourpark`)

---

## 서비스 한 줄 설명

연구자가 IRB(기관생명윤리위원회) 심의 서류를 AI의 도움을 받아 모듈 단위로 작성하고, Word/PDF로 내보낼 수 있는 웹 서비스입니다.

---

## 전체 서비스 목적

대학병원이나 연구기관에서 임상·생명 연구를 시작하려면 IRB 심의를 통과해야 합니다. 이 심의를 위한 서류 작성은 항목이 많고 전문 용어가 많아 연구자들이 어려움을 겪습니다.

YourPark은 이 과정을 다음과 같이 간소화합니다:

1. 연구자가 소속 학교(기관)를 선택하면 해당 기관에서 요구하는 IRB 항목이 자동으로 구성됩니다.
2. 각 항목에 키워드만 입력하면 Claude AI가 전문적인 초안을 자동으로 작성해줍니다.
3. 작성된 내용을 검토하고 Word(.docx) 또는 PDF로 바로 내보낼 수 있습니다.

---

## 주요 사용자 유형

| 사용자 유형 | 설명 |
|------------|------|
| 연구자 (Researcher) | IRB 서류를 직접 작성해야 하는 교수, 의사, 대학원생 등 |

> 현재 구현된 역할은 단일 사용자(연구자) 유형입니다. 관리자(Admin) 역할은 미구현 상태입니다.

---

## 주요 페이지 목록 및 역할

| 경로 | 파일 위치 | 역할 |
|------|----------|------|
| `/` | `app/page.tsx` | 랜딩 페이지 — 서비스 소개 |
| `/auth/login` | `app/auth/login/page.tsx` | 로그인 페이지 |
| `/auth/register` | `app/auth/register/page.tsx` | 회원가입 페이지 |
| `/dashboard` | `app/dashboard/page.tsx` | 내 프로젝트 목록 관리 |
| `/projects/new` | `app/projects/new/page.tsx` | 새 IRB 프로젝트 생성 (2단계 마법사) |
| `/projects/[id]/workspace` | `app/projects/[id]/workspace/page.tsx` | 모듈별 내용 작성 + AI 초안 생성 |
| `/projects/[id]/review` | `app/projects/[id]/review/page.tsx` | 최종 검토 + 문서 내보내기 |

### 각 페이지 상세 설명

**랜딩 페이지 (`/`)**
서비스를 처음 방문한 사용자에게 YourPark을 소개하는 마케팅 페이지입니다. 로그인 없이 접근 가능하며, Header / HeroSection / Footer 섹션으로 구성됩니다.

**로그인 / 회원가입 (`/auth/*`)**
이메일과 비밀번호 기반 인증 페이지입니다. NextAuth.js의 Credentials Provider를 사용합니다. 비밀번호는 bcrypt로 해싱되어 저장됩니다.

**대시보드 (`/dashboard`)**
로그인한 사용자의 IRB 프로젝트 목록을 카드 형태로 보여줍니다. 각 카드에는 프로젝트 이름, 소속 기관, 진행 상태(DRAFT / IN_PROGRESS / COMPLETED), 마지막 수정 시간이 표시됩니다. 프로젝트 삭제도 이 페이지에서 가능합니다.

**새 프로젝트 생성 (`/projects/new`)**
2단계 마법사 형태입니다.
- Step 1: 프로젝트 이름 입력 + 소속 기관(학교) 선택
- Step 2: 해당 기관의 IRB 필수 항목은 자동으로 선택되며, 선택적 항목을 추가로 선택 가능

**작업 공간 (`/projects/[id]/workspace`)**
핵심 기능 페이지입니다. 선택된 IRB 모듈이 카드 형태로 표시됩니다. 각 카드에서:
- 키워드를 입력하고 AI 초안 생성 버튼을 누르면 Claude가 전문 문장을 작성해줍니다.
- 텍스트 영역에서 직접 편집도 가능합니다.
- 내용은 3초 뒤 자동으로 저장됩니다. 오프라인 상태에서는 브라우저 로컬스토리지에 임시 저장되었다가, 온라인으로 돌아오면 자동으로 서버에 동기화됩니다.

**최종 검토 (`/projects/[id]/review`)**
작성된 모든 모듈의 내용을 한눈에 확인하는 페이지입니다. 미작성 항목은 빨간색으로 강조 표시됩니다. 모든 내용을 확인한 뒤 Word(.docx) 또는 PDF로 다운로드할 수 있습니다.

---

## 주요 기능 흐름

```
[회원가입 / 로그인]
       ↓
[대시보드] — 기존 프로젝트 목록 확인 및 삭제
       ↓
[새 프로젝트 만들기]
  Step 1: 프로젝트명 + 소속 기관 선택
  Step 2: IRB 항목(모듈) 선택 (필수 항목 자동선택)
       ↓
[작업 공간]
  - 각 IRB 항목 카드에서 키워드 입력
  - AI(Claude) 초안 자동 생성
  - 내용 수정 및 자동저장 (3초 debounce)
  - 오프라인 시 로컬스토리지 임시 저장 → 온라인 복구 시 자동 동기화
       ↓
[최종 검토]
  - 전체 내용 확인
  - 미작성 항목 경고 표시
  - DOCX 또는 PDF 다운로드
```

---

## 현재 구현된 기능

- 이메일/비밀번호 기반 회원가입 및 로그인 (NextAuth.js)
- 프로젝트 생성 / 조회 / 삭제
- 기관별 IRB 모듈 자동 구성 (현재 서울대, 연세대, 고려대 3개 기관 seed 데이터)
- 모듈별 내용 작성 및 3초 debounce 자동저장
- AI 초안 생성 (Claude Sonnet 4.5, Anthropic API)
- 오프라인 드래프트 임시 저장 및 온라인 복구 시 자동 동기화
- 최종 검토 페이지 (미작성 항목 강조)
- Word(.docx) 및 PDF 문서 내보내기
- 다크모드/라이트모드 테마 전환

---

## 미완성 또는 개선이 필요한 기능

- **관리자 페이지 없음**: 기관 및 모듈 추가/수정은 DB seed나 직접 DB 수정으로만 가능
- **비밀번호 찾기/재설정 없음**: 이메일 인증 또는 비밀번호 초기화 기능 미구현
- **프로젝트 상태 관리 미흡**: DRAFT / IN_PROGRESS / COMPLETED 상태가 있으나 자동 전환 로직 없음
- **PDF 생성 품질**: `generatePdf.ts`가 존재하지만 DOCX 대비 품질 및 한글 폰트 처리가 완성도 낮을 수 있음
- **기관 확장성**: 현재 3개 기관(서울대, 연세대, 고려대)만 seed 데이터에 존재
- **테스트 커버리지**: Vitest 기반 테스트 파일이 일부 존재하나 전체 커버리지 낮음

---

## 주요 파일 구조

```
2026_GraduationProject/
├── app/                          # Next.js App Router 루트
│   ├── layout.tsx                # 전역 레이아웃, 메타데이터, ThemeProvider
│   ├── page.tsx                  # 랜딩 페이지
│   ├── auth/
│   │   ├── login/page.tsx        # 로그인 페이지
│   │   └── register/page.tsx     # 회원가입 페이지
│   ├── dashboard/
│   │   └── page.tsx              # 대시보드 (프로젝트 목록)
│   ├── projects/
│   │   ├── new/page.tsx          # 새 프로젝트 생성 마법사
│   │   └── [id]/
│   │       ├── workspace/page.tsx # 모듈 작성 공간
│   │       └── review/page.tsx    # 최종 검토 + 내보내기
│   └── api/                      # API Routes (백엔드)
│       ├── auth/
│       │   ├── register/route.ts  # POST 회원가입
│       │   └── [...nextauth]/route.ts # NextAuth 핸들러
│       ├── projects/
│       │   ├── route.ts           # GET 목록 / POST 생성
│       │   └── [id]/
│       │       ├── route.ts       # GET·PATCH·DELETE 프로젝트
│       │       └── modules/[moduleId]/route.ts # PATCH 모듈 내용 저장
│       ├── institutions/
│       │   ├── route.ts           # GET 기관 목록
│       │   └── [id]/modules/route.ts # GET 기관별 모듈 목록
│       ├── ai/generate/route.ts   # POST AI 초안 생성
│       └── export/route.ts        # POST DOCX/PDF 내보내기
│
├── components/                   # React 컴포넌트
│   ├── auth/                     # 로그인·회원가입 폼
│   ├── dashboard/                # 대시보드 UI (카드, 헤더, 삭제 다이얼로그)
│   ├── landing/                  # 랜딩 페이지 섹션
│   ├── projects/                 # 프로젝트 생성 마법사, 기관/모듈 선택기
│   ├── review/                   # 최종 검토 UI, 내보내기 버튼
│   ├── workspace/                # 모듈 카드, AI 버튼, 자동저장 상태 표시
│   └── ui/                       # 공통 UI (테마 토글 등)
│
├── lib/                          # 비즈니스 로직 및 유틸
│   ├── auth.ts                   # NextAuth 설정
│   ├── prisma.ts                 # Prisma Client 싱글톤
│   ├── anthropic.ts              # Anthropic SDK 싱글톤
│   ├── irb/
│   │   ├── buildPrompt.ts        # Claude 프롬프트 생성
│   │   ├── parser.ts             # IRB 모듈 데이터 검증
│   │   └── prettyPrint.ts        # IRB 데이터 텍스트 변환
│   └── export/
│       ├── generateDocx.ts       # Word 문서 생성
│       └── generatePdf.ts        # PDF 문서 생성
│
├── hooks/                        # 커스텀 React Hooks
│   ├── useAutoSave.ts            # 3초 debounce 자동저장
│   └── useNetworkSync.ts         # 오프라인 드래프트 동기화
│
├── prisma/
│   ├── schema.prisma             # DB 스키마 정의
│   ├── seed.ts                   # 초기 데이터 (기관, 모듈, 개발용 계정)
│   └── migrations/               # DB 마이그레이션 기록
│
├── .env.local                    # 환경변수 (로컬 전용, git 제외)
└── package.json                  # 의존성 및 스크립트
```

---

## 프론트엔드 구조

**프레임워크**: Next.js 14+ (App Router)  
**언어**: TypeScript  
**스타일링**: Tailwind CSS  
**테마**: next-themes (다크/라이트 모드)  
**아이콘**: lucide-react

### 상태 관리 방식
별도의 전역 상태 관리 라이브러리(Redux, Zustand 등)를 사용하지 않습니다. 각 컴포넌트 내부의 `useState`와 커스텀 훅으로 상태를 관리합니다.

### 주요 커스텀 훅

**`useAutoSave`** (`hooks/useAutoSave.ts`)
- 사용자가 텍스트를 입력하면 3초 후 자동으로 PATCH API를 호출합니다.
- 저장 상태는 `idle → saving → saved / error` 순서로 변합니다.
- 저장 실패 시 `localStorage`에 `draft_{projectId}_{moduleId}` 키로 임시 저장합니다.

**`useNetworkSync`** (`hooks/useNetworkSync.ts`)
- 브라우저의 `online` 이벤트를 감지합니다.
- 온라인 복구 시 `localStorage`에 남아있는 모든 draft를 서버에 동기화합니다.

---

## 백엔드 / API 구조

Next.js API Routes 방식으로 백엔드를 구현합니다. 별도의 서버 프로세스 없이 Next.js 서버 내에서 처리됩니다.

### API 목록

| 메서드 | 경로 | 역할 |
|--------|------|------|
| POST | `/api/auth/register` | 회원가입 |
| GET·POST | `/api/auth/[...nextauth]` | NextAuth 인증 (로그인·로그아웃·세션) |
| GET | `/api/projects` | 내 프로젝트 목록 조회 |
| POST | `/api/projects` | 새 프로젝트 생성 |
| GET | `/api/projects/[id]` | 특정 프로젝트 상세 조회 |
| PATCH | `/api/projects/[id]` | 프로젝트 이름·상태 수정 |
| DELETE | `/api/projects/[id]` | 프로젝트 삭제 |
| PATCH | `/api/projects/[id]/modules/[moduleId]` | 모듈 내용 자동저장 |
| GET | `/api/institutions` | 기관 목록 조회 |
| GET | `/api/institutions/[id]/modules` | 기관별 IRB 모듈 목록 조회 |
| POST | `/api/ai/generate` | Claude AI 초안 생성 |
| POST | `/api/export` | DOCX·PDF 문서 내보내기 |

### 인증 방식
모든 프로젝트 관련 API는 `getServerSession(authOptions)`로 로그인 여부를 확인합니다. 미인증 요청은 `401 Unauthorized`를 반환합니다.

---

## 데이터 저장 방식

**ORM**: Prisma  
**데이터베이스**: SQLite (로컬 개발), 파일 위치: `prisma/irb_master.db`

### 데이터 모델 관계

```
User (사용자)
 └── Project[] (프로젝트, 1:N)
        ├── Institution (소속 기관, N:1)
        └── ProjectModule[] (프로젝트별 모듈, 1:N)
               └── IRBModule (IRB 항목 정의, N:1)

Institution (기관)
 └── InstitutionModule[] (기관별 모듈 구성, 1:N)
        └── IRBModule (IRB 항목 정의, N:1)
```

### 주요 테이블 설명

**User**: 사용자 계정. 비밀번호는 bcrypt 해시로 저장.

**Institution**: 기관(학교) 정보. 현재 서울대, 연세대, 고려대 3개.

**IRBModule**: IRB 심의 항목 정의. 항목명, 설명, 카테고리, 필수 여부, AI 프롬프트 힌트 등 포함. 현재 10개 항목.

**InstitutionModule**: 기관별로 어떤 IRB 항목이 필요한지 매핑. 우선순위(priority)와 필수 여부(isRequired)를 기관마다 다르게 설정 가능.

**Project**: 사용자가 생성한 IRB 서류 작성 프로젝트. 상태는 DRAFT / IN_PROGRESS / COMPLETED.

**ProjectModule**: 프로젝트 내 각 IRB 항목의 실제 작성 내용(content). 프로젝트 삭제 시 함께 삭제(Cascade).

---

## 실행 방법

### 1. 환경변수 설정
프로젝트 루트에 `.env.local` 파일 생성:

```env
DATABASE_URL="file:./prisma/irb_master.db"
NEXTAUTH_SECRET="임의의-랜덤-문자열"
NEXTAUTH_URL="http://localhost:3000"
ANTHROPIC_API_KEY="sk-ant-..."
```

### 2. 패키지 설치
```bash
npm install
```

### 3. DB 초기화
```bash
# 마이그레이션 적용 (DB 파일 및 테이블 생성)
npx prisma migrate deploy

# Prisma 클라이언트 생성
npx prisma generate

# 초기 데이터 삽입 (기관, 모듈, 개발용 계정)
npm run db:seed
```

### 4. 개발 서버 실행
```bash
npm run dev
```
→ http://localhost:3000 에서 확인

### 로컬 개발용 계정
- **이메일**: `dev@test.com`
- **비밀번호**: `password123`

---

## 다른 LLM에게 전달할 요약 프롬프트

아래 내용을 복사해서 GPT, Gemini 등에 붙여넣으면 이 프로젝트를 빠르게 설명할 수 있습니다.

---

이 프로젝트는 **YourPark**으로, 연구자가 IRB(기관생명윤리위원회) 심의 서류를 AI의 도움을 받아 작성하고 Word/PDF로 내보낼 수 있는 Next.js 기반 웹 서비스입니다.

현재 구현된 주요 기능은 다음과 같습니다:
- 이메일/비밀번호 기반 회원가입 및 로그인 (NextAuth.js + bcrypt)
- 소속 기관(학교) 선택 → 해당 기관의 IRB 항목 자동 구성 → 프로젝트 생성
- 각 IRB 항목에 키워드를 입력하면 Claude AI(claude-sonnet-4-5)가 전문 문장을 초안 생성
- 3초 debounce 자동저장, 오프라인 드래프트 로컬스토리지 임시 저장 및 온라인 복구 시 자동 동기화
- 최종 검토 페이지에서 미작성 항목 경고 표시 및 DOCX / PDF 내보내기

기술 스택은 Next.js 14 (App Router) + TypeScript + Tailwind CSS + Prisma (SQLite) + NextAuth.js + Anthropic SDK입니다.

주요 파일 위치:
- 페이지: `app/` 폴더 (page.tsx 파일들)
- API: `app/api/` 폴더 (route.ts 파일들)
- 컴포넌트: `components/` 폴더
- 비즈니스 로직: `lib/` 폴더
- DB 스키마: `prisma/schema.prisma`
- 커스텀 훅: `hooks/useAutoSave.ts`, `hooks/useNetworkSync.ts`

앞으로 도움받고 싶은 부분은 관리자 페이지 구현, 비밀번호 재설정 기능, 기관 확장, PDF 한글 폰트 처리 개선, 프로젝트 상태 자동 전환 로직입니다.

아래 코드를 기준으로 구조를 이해하고 답변해주세요.
