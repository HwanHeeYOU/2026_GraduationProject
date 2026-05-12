# Tasks

## Task List

- [x] 1. 프로젝트 초기 설정
  - [x] 1.1 Next.js 14 (App Router) + TypeScript + Tailwind CSS 프로젝트 생성
  - [x] 1.2 Prisma ORM 설정 및 SQLite (irb_master.db) 연결
  - [x] 1.3 NextAuth.js JWT 인증 설정
  - [x] 1.4 Prisma 스키마 정의 (User, Institution, IRBModule, InstitutionModule, Project, ProjectModule)
  - [x] 1.5 DB 마이그레이션 및 IRB 항목 시드 데이터 작성 (prisma/seed.ts)
  - [x] 1.6 환경 변수 설정 (.env.local: DATABASE_URL, NEXTAUTH_SECRET, ANTHROPIC_API_KEY)

- [x] 2. 랜딩 페이지 구현
  - [x] 2.1 기존 YourPark_landingpage App.tsx 기반으로 Next.js 랜딩 페이지 컴포넌트 이식
  - [x] 2.2 Glassmorphism 스타일 Tailwind CSS 유틸리티 클래스 정의
  - [x] 2.3 Hero Section 구현 (야간 캠퍼스 배경, "50+ 기관 파트너", "99.5% 규정 준수 성공률" 수치 표시)
  - [x] 2.4 "지금 바로 시작하기" 및 "무료로 항목 진단받기" CTA 버튼 구현 및 라우팅 연결

- [x] 3. 사용자 인증 구현
  - [x] 3.1 NextAuth.js Credentials Provider 설정 (이메일/비밀번호)
  - [x] 3.2 회원가입 API Route 구현 (POST /api/auth/register, bcrypt 해싱)
  - [x] 3.3 로그인/회원가입 페이지 UI 구현 (Glassmorphism 스타일)
  - [x] 3.4 미들웨어 설정 (미인증 사용자 /auth/login 리다이렉트)
  - [x] 3.5 인증 오류 메시지 처리 (잘못된 자격증명, 중복 이메일)

- [x] 4. 대시보드 구현
  - [x] 4.1 대시보드 페이지 레이아웃 구현 (프로젝트 카드 그리드)
  - [x] 4.2 프로젝트 목록 API Route 구현 (GET /api/projects)
  - [x] 4.3 프로젝트 카드 컴포넌트 구현 (프로젝트명, 학교, 마지막 수정 일시, 진행 상태)
  - [x] 4.4 프로젝트 삭제 기능 구현 (확인 다이얼로그 포함, DELETE /api/projects/:id)
  - [x] 4.5 다크/라이트 모드 전환 기능 구현 (next-themes)

- [x] 5. 학교 선택 및 IRB 모듈 동적 로딩
  - [x] 5.1 학교 목록 API Route 구현 (GET /api/institutions)
  - [x] 5.2 학교별 IRB 모듈 목록 API Route 구현 (GET /api/institutions/:id/modules)
  - [x] 5.3 학교 선택 드롭다운 컴포넌트 구현 (검색 기능 포함)
  - [x] 5.4 IRB 모듈 선택 체크박스 리스트 구현 (필수/선택 여부 시각적 구분)
  - [x] 5.5 프로젝트 생성 API Route 구현 (POST /api/projects, 선택된 모듈 저장)
  - [x] 5.6 학교 데이터 로드 오류 처리 구현

- [x] 6. 모듈형 Workspace 구현
  - [x] 6.1 Workspace 페이지 레이아웃 구현 (카드 그리드, Glassmorphism 스타일)
  - [x] 6.2 ModuleCard 컴포넌트 구현 (키워드 입력 필드, 텍스트 편집 영역)
  - [x] 6.3 KaTeX 수식 렌더링 통합 (hasFormula 모듈 대상)
  - [x] 6.4 SaveStatusIndicator 컴포넌트 구현 ("저장 중...", "저장됨", "저장 실패")
  - [x] 6.5 모듈 내용 업데이트 API Route 구현 (PATCH /api/projects/:id/modules/:moduleId)

- [x] 7. 자동 저장 및 데이터 영속성 구현
  - [x] 7.1 useAutoSave 훅 구현 (debounce 3초, localStorage 폴백)
  - [x] 7.2 네트워크 오류 시 localStorage 임시 저장 로직 구현
  - [x] 7.3 네트워크 복구 시 localStorage → 서버 동기화 로직 구현 (online 이벤트 리스너)

- [x] 8. AI 문장 생성 (백엔드 API)
  - [x] 8.1 Anthropic Claude Sonnet API 클라이언트 설정
  - [x] 8.2 AI 생성 API Route 구현 (POST /api/ai/generate, 30초 타임아웃)
  - [x] 8.3 IRB 항목별 최적화 프롬프트 구성 로직 구현 (IRBModule.promptHint 활용)
  - [x] 8.4 AI 요청/응답 로깅 구현
  - [x] 8.5 AIGenerateButton 컴포넌트 구현 (로딩 상태, 오류 처리)

- [x] 9. 최종 검토 및 내보내기
  - [x] 9.1 최종 검토 페이지 구현 (모든 모듈 순서대로 표시, 인라인 편집)
  - [x] 9.2 미완성 항목 감지 및 시각적 강조 표시 구현
  - [x] 9.3 DOCX 내보내기 구현 (docx 라이브러리)
  - [x] 9.4 PDF 내보내기 구현 (jsPDF 라이브러리)
  - [x] 9.5 내보내기 API Route 구현 (POST /api/export)
  - [x] 9.6 미완성 항목 존재 시 확인 다이얼로그 구현

- [x] 10. IRB 데이터 파싱 및 직렬화
  - [x] 10.1 IRBModule 파싱 함수 구현 (lib/irb/parser.ts)
  - [x] 10.2 Pretty_Printer 구현 (lib/irb/prettyPrint.ts)
  - [x] 10.3 유효하지 않은 데이터 오류 처리 구현 (필수 필드 누락 감지)

- [x] 11. 테스트 작성
  - [x] 11.1 Vitest + React Testing Library 설정
  - [x] 11.2 fast-check 속성 기반 테스트 설정
  - [x] 11.3 단위 테스트: 랜딩 페이지 CTA 버튼 렌더링 및 네비게이션
  - [x] 11.4 단위 테스트: 인증 폼 유효성 검사 및 오류 메시지
  - [x] 11.5 단위 테스트: 대시보드 프로젝트 카드 렌더링
  - [x] 11.6 단위 테스트: AI 생성 타임아웃 처리
  - [x] 11.7 단위 테스트: 미완성 항목 다운로드 경고
  - [x] 11.8 속성 테스트: 인증 round-trip (Property 1, 2, 3, 4)
  - [x] 11.9 속성 테스트: 자동 저장 debounce 및 localStorage 폴백 (Property 12, 13, 14, 15)
  - [x] 11.10 속성 테스트: IRB 데이터 파싱 round-trip (Property 19, 20, 21, 22)
  - [x] 11.11 속성 테스트: AI 생성 요청/응답 형식 (Property 10, 11)
