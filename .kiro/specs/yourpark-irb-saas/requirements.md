# Requirements Document

## Introduction

YourPark는 연구자들이 IRB(Institutional Review Board, 기관생명윤리위원회) 심의 서류를 효율적으로 작성할 수 있도록 돕는 모듈형 SaaS 플랫폼입니다. 사용자는 학교/기관을 선택하면 해당 기관의 IRB 심의 기준에 맞는 항목이 동적으로 로드되고, AI(Claude Sonnet)를 활용해 각 항목별 문장 초안을 자동 생성할 수 있습니다. 서비스는 Glassmorphism 디자인 언어와 다크 네이비 기반의 야간 캠퍼스 비주얼 테마를 적용하며, 기존 Figma 디자인(YourPark_landingpage)을 기반으로 구현됩니다.

---

## Glossary

- **YourPark**: 본 서비스의 명칭. 모듈형 IRB 작성 보조 SaaS 플랫폼.
- **IRB**: Institutional Review Board. 기관생명윤리위원회. 연구 윤리 심의를 담당하는 기관 내 위원회.
- **IRB_Module**: IRB 심의 서류를 구성하는 개별 항목 단위 (예: 연구 목적, 대상자 선정 기준, 표본 크기 계산 등).
- **Workspace**: 사용자가 IRB 서류를 작성하는 메인 편집 화면. 선택된 모듈들이 카드 형태로 배치됨.
- **AI_Generator**: Claude Sonnet API와 통신하여 각 IRB_Module에 대한 문장 초안을 생성하는 백엔드 서비스.
- **Institution_DB**: 학교/기관별 IRB 심의 기준 및 우선순위 항목 정보를 저장하는 데이터베이스.
- **IRB_Master_DB**: IRB 항목 속성 및 메타데이터를 저장하는 데이터베이스 (irb_master.db).
- **Project**: 사용자가 생성하는 IRB 작성 단위. 학교 선택, 모듈 선택, 문장 생성 결과를 포함.
- **Landing_Page**: 비로그인 사용자에게 노출되는 서비스 소개 페이지.
- **Dashboard**: 로그인 후 사용자의 프로젝트 목록 및 진행 상황을 보여주는 관리 화면.
- **Glassmorphism**: 반투명 유리 질감의 UI 디자인 스타일. backdrop-filter blur, 반투명 배경, 테두리 하이라이트를 특징으로 함.
- **Pretty_Printer**: 구조화된 데이터를 사람이 읽기 쉬운 형식으로 출력하는 기능.

---

## Requirements

### Requirement 1: 랜딩 페이지 표시

**User Story:** 연구자로서, 서비스 소개 랜딩 페이지를 통해 YourPark의 핵심 가치와 신뢰 지표를 확인하고 싶다. 그래야 서비스 가입 여부를 결정할 수 있다.

#### Acceptance Criteria

1. THE Landing_Page SHALL 야간 캠퍼스 배경 이미지 위에 다크 네이비와 화이트 색상 조합으로 Hero Section을 렌더링한다.
2. THE Landing_Page SHALL 헤더 영역에 "50+ 기관 파트너"와 "99.5% 규정 준수 성공률" 수치를 표시한다.
3. THE Landing_Page SHALL "지금 바로 시작하기" 및 "무료로 항목 진단받기" CTA 버튼을 Hero Section 내에 렌더링한다.
4. THE Landing_Page SHALL Glassmorphism 스타일(backdrop-filter blur, 반투명 배경, 테두리 하이라이트)을 전체 UI 컴포넌트에 적용한다.
5. WHEN 사용자가 "지금 바로 시작하기" 버튼을 클릭하면, THE Landing_Page SHALL 회원가입/로그인 페이지로 이동한다.
6. WHEN 사용자가 "무료로 항목 진단받기" 버튼을 클릭하면, THE Landing_Page SHALL 항목 진단 플로우 또는 회원가입 페이지로 이동한다.
7. THE Landing_Page SHALL 기존 YourPark_landingpage Figma 디자인 컴포넌트(App.tsx, Concept9.tsx)를 기반으로 구현된다.

---

### Requirement 2: 사용자 인증

**User Story:** 연구자로서, 이메일과 비밀번호로 회원가입 및 로그인을 할 수 있어야 한다. 그래야 내 프로젝트를 안전하게 관리할 수 있다.

#### Acceptance Criteria

1. THE YourPark SHALL 이메일, 비밀번호를 입력받아 신규 사용자 계정을 생성하는 회원가입 기능을 제공한다.
2. WHEN 사용자가 유효한 이메일과 비밀번호를 입력하고 로그인을 시도하면, THE YourPark SHALL 인증 토큰을 발급하고 Dashboard로 이동시킨다.
3. IF 사용자가 잘못된 이메일 또는 비밀번호를 입력하면, THEN THE YourPark SHALL "이메일 또는 비밀번호가 올바르지 않습니다" 오류 메시지를 표시한다.
4. IF 사용자가 이미 등록된 이메일로 회원가입을 시도하면, THEN THE YourPark SHALL "이미 사용 중인 이메일입니다" 오류 메시지를 표시한다.
5. WHEN 사용자가 로그아웃을 요청하면, THE YourPark SHALL 인증 토큰을 무효화하고 Landing_Page로 이동시킨다.
6. WHILE 사용자가 인증되지 않은 상태이면, THE YourPark SHALL Dashboard 및 Workspace 접근을 차단하고 로그인 페이지로 리다이렉트한다.

---

### Requirement 3: 대시보드 및 프로젝트 관리

**User Story:** 연구자로서, 로그인 후 내 IRB 프로젝트 목록을 한눈에 보고 관리하고 싶다. 그래야 여러 연구 프로젝트를 효율적으로 진행할 수 있다.

#### Acceptance Criteria

1. WHEN 사용자가 로그인에 성공하면, THE Dashboard SHALL 다크/라이트 모드가 조화된 관리자 대시보드 화면으로 전환된다.
2. THE Dashboard SHALL 사용자의 프로젝트 목록을 카드 형태로 표시하며, 각 카드에는 프로젝트명, 선택된 학교, 마지막 수정 일시, 진행 상태를 포함한다.
3. WHEN 사용자가 "새 프로젝트 만들기" 버튼을 클릭하면, THE Dashboard SHALL 프로젝트 생성 플로우(학교 선택 단계)로 이동한다.
4. WHEN 사용자가 기존 프로젝트 카드를 클릭하면, THE Dashboard SHALL 해당 프로젝트의 Workspace로 이동한다.
5. WHEN 사용자가 프로젝트 삭제를 요청하면, THE Dashboard SHALL 확인 다이얼로그를 표시한 후 삭제를 처리한다.
6. THE Dashboard SHALL 다크 모드와 라이트 모드 전환 기능을 제공한다.

---

### Requirement 4: 학교 선택 및 IRB 모듈 동적 로딩

**User Story:** 연구자로서, 내 소속 학교를 선택하면 해당 학교의 IRB 기준에 맞는 항목들이 자동으로 로드되길 원한다. 그래야 학교별 요구사항을 놓치지 않고 서류를 작성할 수 있다.

#### Acceptance Criteria

1. THE YourPark SHALL Institution_DB에 등록된 학교/기관 목록을 검색 가능한 드롭다운 형태로 제공한다.
2. WHEN 사용자가 학교를 선택하면, THE YourPark SHALL Institution_DB에서 해당 학교의 IRB 심의 기준에 따른 우선순위 항목 목록을 로드한다.
3. WHEN 학교 선택 후 항목 목록이 로드되면, THE YourPark SHALL 각 IRB_Module을 체크박스가 포함된 인터랙티브 리스트로 표시한다.
4. THE YourPark SHALL 각 IRB_Module 항목에 필수/선택 여부를 시각적으로 구분하여 표시한다.
5. WHEN 사용자가 모듈 선택을 완료하고 "다음" 버튼을 클릭하면, THE YourPark SHALL 선택된 IRB_Module 목록을 저장하고 Workspace로 이동한다.
6. IF 학교 데이터 로드 중 오류가 발생하면, THEN THE YourPark SHALL "학교 정보를 불러오는 데 실패했습니다. 다시 시도해 주세요." 오류 메시지를 표시한다.

---

### Requirement 5: 모듈형 Workspace (IRB 문서 편집)

**User Story:** 연구자로서, 선택한 IRB 항목들을 카드 형태로 보면서 각 항목별로 AI 초안을 생성하고 직접 편집하고 싶다. 그래야 완성도 높은 IRB 서류를 빠르게 작성할 수 있다.

#### Acceptance Criteria

1. THE Workspace SHALL 선택된 IRB_Module들을 개별 카드 형태로 배치하여 표시한다.
2. THE Workspace SHALL 각 카드 내부에 연구 키워드 입력 필드(AI 프롬프트 필드)를 제공한다.
3. WHEN 사용자가 키워드를 입력하고 "AI 초안 생성" 버튼을 클릭하면, THE Workspace SHALL AI_Generator에 selected_items 리스트와 키워드를 전달하여 문장 초안을 요청한다.
4. WHEN AI_Generator가 응답을 반환하면, THE Workspace SHALL 해당 카드의 텍스트 편집 영역에 생성된 문장을 표시한다.
5. THE Workspace SHALL 각 카드의 텍스트 편집 영역에서 사용자가 직접 내용을 수정할 수 있도록 한다.
6. THE Workspace SHALL 표본 크기 계산 모듈 등 수식이 포함된 항목에서 수식을 렌더링하여 표시한다.
7. WHEN 사용자가 내용을 수정하면, THE Workspace SHALL 3초 이내에 자동 저장을 수행하고 저장 상태 인디케이터를 표시한다.
8. IF AI_Generator 호출 중 오류가 발생하면, THEN THE Workspace SHALL "AI 초안 생성에 실패했습니다. 다시 시도해 주세요." 오류 메시지를 해당 카드에 표시한다.
9. THE Workspace SHALL Glassmorphism 스타일의 카드 레이아웃을 적용한다.

---

### Requirement 6: AI 문장 생성 (백엔드 API)

**User Story:** 연구자로서, 연구 키워드를 입력하면 각 IRB 항목에 최적화된 문장 초안을 AI가 자동으로 생성해 주길 원한다. 그래야 전문적인 IRB 서류 작성 시간을 단축할 수 있다.

#### Acceptance Criteria

1. THE AI_Generator SHALL selected_items 리스트와 연구 키워드를 입력받아 각 항목별로 최적화된 프롬프트를 구성한다.
2. THE AI_Generator SHALL 구성된 프롬프트를 Claude Sonnet API에 전달하여 문장 초안을 생성한다.
3. WHEN AI_Generator가 문장 초안을 생성하면, THE AI_Generator SHALL 생성된 텍스트를 JSON 형식으로 Workspace에 반환한다.
4. THE AI_Generator SHALL IRB_Master_DB의 항목 속성 데이터를 참조하여 각 항목에 맞는 프롬프트를 생성한다.
5. IF Claude Sonnet API 호출이 30초 이내에 응답하지 않으면, THEN THE AI_Generator SHALL 타임아웃 오류를 반환한다.
6. THE AI_Generator SHALL API 요청 및 응답 로그를 기록한다.

---

### Requirement 7: 최종 검토 및 내보내기

**User Story:** 연구자로서, 작성 완료된 IRB 서류 전체를 한 페이지에서 검토하고 다운로드하고 싶다. 그래야 제출 전 최종 확인을 할 수 있다.

#### Acceptance Criteria

1. THE YourPark SHALL 모든 IRB_Module의 작성 내용을 하나의 최종 검토 페이지에 순서대로 표시한다.
2. THE YourPark SHALL 최종 검토 페이지에서 각 항목의 내용을 직접 수정할 수 있는 인라인 편집 기능을 제공한다.
3. WHEN 사용자가 "다운로드" 버튼을 클릭하면, THE YourPark SHALL 작성된 IRB 서류를 DOCX 또는 PDF 형식으로 내보낸다.
4. THE YourPark SHALL 최종 검토 페이지에서 미완성 항목(내용이 비어 있는 카드)을 시각적으로 강조 표시한다.
5. IF 미완성 항목이 존재하는 상태에서 다운로드를 시도하면, THEN THE YourPark SHALL "미완성 항목이 있습니다. 계속 진행하시겠습니까?" 확인 메시지를 표시한다.

---

### Requirement 8: 실시간 저장 및 데이터 영속성

**User Story:** 연구자로서, 작업 중 데이터가 자동으로 저장되길 원한다. 그래야 예기치 않은 브라우저 종료나 네트워크 오류로 인한 데이터 손실을 방지할 수 있다.

#### Acceptance Criteria

1. WHILE 사용자가 Workspace에서 편집 중이면, THE YourPark SHALL 마지막 입력으로부터 3초 후 자동 저장을 수행한다.
2. THE Workspace SHALL 저장 상태를 "저장 중...", "저장됨", "저장 실패" 세 가지 상태로 인디케이터에 표시한다.
3. IF 자동 저장 중 네트워크 오류가 발생하면, THEN THE YourPark SHALL 로컬 스토리지에 임시 저장하고 "저장 실패 - 로컬에 임시 저장됨" 메시지를 표시한다.
4. WHEN 네트워크가 복구되면, THE YourPark SHALL 로컬 스토리지의 임시 저장 데이터를 서버에 동기화한다.
5. THE YourPark SHALL 프로젝트 데이터를 서버 데이터베이스에 영속적으로 저장한다.

---

### Requirement 9: 반응형 UI 및 접근성

**User Story:** 연구자로서, 다양한 디바이스(데스크탑, 태블릿)에서 YourPark를 사용하고 싶다. 그래야 장소에 구애받지 않고 IRB 서류를 작성할 수 있다.

#### Acceptance Criteria

1. THE Landing_Page SHALL 데스크탑(1280px 이상), 태블릿(768px~1279px) 화면 크기에서 레이아웃이 올바르게 표시된다.
2. THE Workspace SHALL 데스크탑(1280px 이상) 화면에서 카드 그리드 레이아웃을 표시하고, 태블릿(768px~1279px) 화면에서 단일 열 레이아웃으로 전환된다.
3. THE YourPark SHALL 모든 인터랙티브 요소에 키보드 접근성(Tab 키 포커스, Enter/Space 키 활성화)을 제공한다.
4. THE YourPark SHALL 텍스트와 배경 간 명도 대비를 WCAG 2.1 AA 기준(4.5:1 이상)에 맞게 유지한다.

---

### Requirement 10: IRB 데이터 파싱 및 직렬화

**User Story:** 개발자로서, IRB_Master_DB의 항목 데이터를 파싱하고 직렬화할 수 있어야 한다. 그래야 데이터 무결성을 보장하고 다양한 형식으로 내보낼 수 있다.

#### Acceptance Criteria

1. WHEN 유효한 IRB 항목 데이터가 제공되면, THE YourPark SHALL 해당 데이터를 IRB_Module 객체로 파싱한다.
2. IF 유효하지 않은 IRB 항목 데이터가 제공되면, THEN THE YourPark SHALL 구체적인 오류 내용을 포함한 오류 응답을 반환한다.
3. THE Pretty_Printer SHALL IRB_Module 객체를 사람이 읽기 쉬운 텍스트 형식으로 출력한다.
4. FOR ALL 유효한 IRB_Module 객체에 대해, 파싱 후 Pretty_Printer로 출력한 결과를 다시 파싱하면 동등한 객체가 생성되어야 한다 (round-trip 속성).
