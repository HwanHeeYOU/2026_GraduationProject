# TODO 01 — 최종 검토 화면의 "누락 정보" 처리 방식 결정

- 상태: **구현 완료 (2026-11-06)** — 아래 "6. 필요한 최소 변경" 1~5번 반영, 6번(HWPX 내보내기 연동)도 반영. 상세는 `docs/WORK_REPORT_2026-11-06.md`
- 작성일: 2026-11-05
- 출처: 친구 질문 — "최종 검토에서 누락 정보가 발견되면 '워크스페이스로 돌아가서 채우기'를 넣을까? 아니면 지금처럼 검토 화면에서 '추가정보를 입력하세요'로 받을까?"

## 원래 의도한 흐름

1. **문서 파싱**: 사용자가 IRB 양식을 업로드하면 작성해야 할 항목을 추출한다.
2. **워크스페이스**: '개별 항목 입력' 또는 '자연어로 한 번에 입력'으로 연구 정보를 채운다. 자연어 입력 시 필요한 항목 목록을 옆에서 볼 수 있다.
3. **최종 검토**: 입력한 정보를 바탕으로 각 문서의 빈칸을 채우고, 추가로 필요한 정보를 안내한다.

## 현재 증상

- 자연어 예시를 넣으면 43개 중 40개가 채워지고, 문서 버전 같은 일부 항목이 남는다.

## 핵심 질문

검토 화면에서 추가정보를 입력했을 때,
그 내용이 **AI에 다시 전달되어 기존 정보와 합쳐지고, 관련 문서들까지 다시 작성되는가?**
(화면이나 저장값만 바뀌는 거면 충분하지 않음)

## 코드로 확인할 것

- [ ] 최초 입력부터 문서 생성까지 거치는 컴포넌트·함수·API
- [ ] 검토 화면의 추가정보 입력이 저장되는 곳, 실행되는 AI 처리와 문서 재생성
- [ ] 워크스페이스로 돌아가서 입력하면 거치는 처리 — 두 방식의 차이
- [ ] 추가정보 반영 시 기존 입력과 사용자가 직접 수정한 내용이 유지되는지
- [ ] 같은 정보가 여러 문서에 쓰일 때 수정 내용이 함께 반영되는지
- [ ] 문서 업로드가 워크스페이스로 들어간 것이 화면 통합뿐인지, 실행 순서까지 바뀐 것인지

## 산출물

`친구 질문의 의미 → 현재 코드의 실제 동작 → 추천 방식과 이유 → 필요한 최소 변경` 순서로,
관련 파일·함수 근거를 붙여 정리. 코드로 확인하지 못한 부분은 추측과 구분해서 표기.

## 분석 결과

> 코드를 읽고 판단한 결과이며, 실제로 실행해서 확인한 것은 아님. 추측은 "(추정)"으로 표기.

### 1. 친구 질문의 의미
- 단순 UI 선택이 아니라 "검토 화면에서 입력한 정보가 **AI 입력으로 재투입되어 관련 문서까지 다시 채워지느냐**"가 핵심.

### 2. 현재 코드의 실제 동작

**최초 입력 → 문서 생성**
1. 파일 업로드 → `POST /api/ai/irb-form-draft` (multipart) = Phase 1: 파일별 문항 추출 → LLM으로 중복 통합 → `IRBFormDraftResult {questions, fileSections(문항→answerKey)}` (`app/api/ai/irb-form-draft/route.ts`)
2. `IRBDynamicForm`(개별 입력 / 자연어)의 `answers`, `naturalInput` — **React state에만 있음, 저장 안 됨** (`components/workspace/IRBDynamicForm.tsx:47-48`)
3. `IRBFormDraftPanel.handleGenerate` → `POST /api/ai/irb-form-draft` (JSON) = Phase 3: 파일별 15문항씩 LLM 호출(`buildMappingPrompt`). 우선순위: 직접입력(answerKey) > 자연어 > 다른 답변 추론 > `[작성 필요]`
4. 결과 `IRBFormDraftOutput {sections:[{fileName, items:[{question, answer}]}], rawText}`를 `Project.formDraftJson`에 **덮어쓰기** 저장 + sessionStorage 저장 → `/review` 이동 (`WorkspaceClient.handleDraftComplete`)

**검토 화면 추가정보 입력 (`ReviewClient.handlePatchSubmit` → `PATCH /api/ai/irb-form-draft`)**
- 입력값: `supplements[`${fileName}|||${question}`]` (React state)
- AI 처리: 파일별로 **누락 항목만** 대상으로 프롬프트("기존 초안 100% 유지, MISSING만 치환") 호출 → 결과를 `formDraftJson`에 다시 덮어쓰기 → `location.reload()`
- 즉 **AI 재처리는 한다.** 다만 범위가 "해당 파일의 해당 문항"으로 한정됨.

**워크스페이스로 돌아가기 (`handleGoBackToFill`)**
- 누락 문항 텍스트만 sessionStorage(`irb_incomplete_keys`)에 담아 이동 → 폼에서 해당 항목을 강조 표시
- 재생성 시 `IRBFormDraftPanel.handleGenerate`가 sessionStorage의 이전 출력에서 **누락 아닌 답변을 answerKey로 역매핑해 "직접 입력값(1순위)"으로 고정**하고 Phase 3를 **전 문항 다시** 실행

**두 방식의 차이**
| | 검토 화면 PATCH | 워크스페이스 복귀 |
|---|---|---|
| 재생성 범위 | 누락 문항만 | 모든 파일·모든 문항 |
| 같은 정보를 다른 문서에 전파 | 안 됨 (파일·문항 단위 키) | 됨 (answerKey 공유) |
| 기존 답변 유지 | 프롬프트 지시에 의존 | 이전 답변을 직접입력으로 고정 |
| 원래 입력(자연어/개별값) | 사용 안 함 | **유실** (state만 있었음) |

### 3. 발견한 문제점 (우선순위 순)
1. **Phase 3/PATCH가 `formDraftJson`을 `IRBFormDraftOutput`으로 덮어써서 문항 구조(`questions`, `fileSections`, answerKey 매핑)가 사라진다.**
   - 결과: 워크스페이스는 구조가 없으면 `formDraft=undefined`로 보고 **업로드 화면부터 다시 시작** (`app/projects/[id]/workspace/page.tsx:60-85`). "돌아가서 채우기"가 사실상 파일 재업로드를 요구함.
   - 검토 화면도 answerKey를 몰라서 같은 정보가 여러 문서에 걸려도 문서별로 따로 입력받음.
2. **사용자 입력 원본이 어디에도 저장되지 않는다.** 자연어 입력·개별 입력은 state뿐. 복귀 후 재생성 시 자연어는 사라지고, 이전 *출력 답변*만 sessionStorage에서 복원됨(탭/세션이 바뀌면 이것도 없음).
3. **PATCH가 코드 레벨 보호 없이 파일 전체를 LLM 출력으로 교체한다.** `updatedItems`가 모든 문항에 `matched ?? item.answer`를 적용 → LLM이 기존 답변을 바꾸거나(프롬프트로만 금지) 출력이 `maxTokens: 3000`에서 잘리면 잘린 답변으로 덮어쓸 수 있음 (추정, 실행 검증 안 함).
4. 보충 입력이 "정보"로 보존되지 않고 **답변 텍스트로만** 남는다. 이후 재생성 때 근거 자료가 되지 못함.
5. 검토 화면에는 **누락이 아닌 답변을 직접 수정하는 UI가 없다.** "사용자가 직접 수정한 내용 유지"는 현재 해당 기능 자체가 없음.
6. `ModuleCard`(모듈별 직접 작성 내용)와 `sourceSummary`는 초안 생성에 **전혀 쓰이지 않는다.** `irb-form-draft` 라우트에 참조 없음, `WorkspaceClient`는 `sourceSummary`를 받기만 하고 쓰지 않음, `/api/ai/summarize-modules`는 호출하는 곳이 없음.

### 4. 문서 업로드가 워크스페이스로 들어갔다는 말의 실제
- 파싱 기능/API는 그대로 `POST /api/ai/irb-form-draft`(Phase 1) 하나.
- 진입점이 2개: ① **프로젝트 생성 위저드**가 파일 업로드 즉시 Phase 1을 실행해 결과를 프로젝트에 저장(`NewProjectWizard.tsx`, 2026-09-16 커밋 `39cc787`) → 워크스페이스는 바로 입력 폼으로 시작. ② 구조가 저장돼 있지 않으면 워크스페이스 패널이 업로드부터 시작(위 문제 1 때문에 생성 이후엔 항상 이쪽).
- 즉 "화면에서 합쳐진 것" + "실행 순서가 앞당겨진 것(생성 시점에 파싱)"이 같이 있음. 이전 흐름(커밋 `e09c264`의 검토 화면 탭 UI)은 이미 제거됨. 친구가 말한 변경이 정확히 어느 커밋인지는 확인하지 못함.

### 5. 추천: 검토 화면에서 바로 입력 (단, 구조를 먼저 고친 뒤)
- 이유: 누락은 보통 1~3개인데 워크스페이스 복귀는 사실상 재업로드 + 전 문항 재생성이라 비용이 크고 입력이 유실됨. PATCH 경로는 이미 있어서 확장이 쉬움.
- 워크스페이스 복귀가 필요한 경우는 "이미 채워진 답을 대량으로 고치고 싶을 때"뿐 → 보조 링크로만 유지.

### 6. 필요한 최소 변경
1. **저장 구조 분리**: 문항 구조(`IRBFormDraftResult`)와 출력(`IRBFormDraftOutput`)을 덮어쓰지 않도록 분리 저장. 예: `formDraftJson`(구조) + `draftOutputJson`(출력) + `userInputJson`(`userAnswers`, `naturalLanguageInput`). → 마이그레이션 1개.
2. **Phase 3 성공 시 사용자 입력 저장**, PATCH 때 보충 정보를 `userAnswers[answerKey]`에 병합 저장.
3. **검토 화면 입력을 answerKey 단위로 묶기**: 같은 키의 누락 문항(여러 파일)은 입력란 1개.
4. **PATCH를 "병합 → 누락 항목만 재생성"으로**: 전체 입력(자연어 + 병합된 answers) + 이전 답변을 컨텍스트로 주고, 같은 answerKey를 쓰는 **모든 파일의 누락 항목**만 재생성. 코드에서 누락이었던 항목만 교체(나머지는 절대 건드리지 않음) + 토큰 잘림 방어.
5. (선택) 누락 아닌 답변 직접 수정 UI + 수정본 고정.
6. (선택) 이번에 만든 HWPX 내보내기는 `draftOutputJson`을 읽도록 맞추기.
