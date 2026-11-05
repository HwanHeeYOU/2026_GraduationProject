# 작업 리포트 — 2026-11-06

> 한 줄 요약: **(1) 업로드한 기관 양식(.hwpx)에 답변을 채워 내보내는 기능**을 만들고, **(2) 최종 검토 화면의 "추가 정보 입력"이 실제로 AI에 재전달되어 관련 문서 전체에 반영되도록** 저장 구조와 화면을 고쳤다.

---

## 1. 오늘 한 일

### A. HWPX 내보내기 (업로드한 양식에 답변 채우기) — 커밋 `b7ee01f`
- **문제**: 최종 내보내기가 DOCX/PDF뿐이었고, 업로드한 기관 양식의 원본은 어디에도 저장되지 않았다.
- **해결**
  - 업로드한 `.hwpx` 원본을 DB에 저장 (`ProjectTemplateFile`). 프로젝트 생성 위저드와 검토 화면 업로드 두 경로 모두.
  - `lib/export/fillHwpx.ts`: 양식의 문항 위치를 찾아 답변을 채움.
    - 표 안 문항 → 오른쪽 빈 칸, 머리글 행이면 아래 칸
    - 표 밖 `라벨:` → 같은 줄 뒤에 / 그 외엔 다음 문단으로 삽입
    - 위치를 못 찾은 문항 → 문서 맨 끝에 모아 붙임 (답변 유실 방지)
    - `[작성 필요]` 항목은 양식에 넣지 않고 비워 둠
    - 원본 서식·표 구조는 유지, 텍스트만 변경
  - `/api/export`에 `format=hwpx` 추가, 양식이 여러 개면 ZIP, HWPX 다운로드 버튼 추가
  - 신규 의존성 `@xmldom/xmldom`

### B. 최종 검토 "추가 정보" 흐름 정상화 — 이번 커밋 (TODO_01 해결)
**발견한 문제 (코드 분석 결과)**
1. 초안 생성 후 `formDraftJson`이 답변 결과로 **덮어써져 문항 구조가 사라짐** → 워크스페이스로 돌아가면 파일 재업로드 요구
2. 사용자가 입력한 정보(자연어/개별 입력)가 **어디에도 저장되지 않음**
3. 검토 화면 보충 입력이 문서·문항 단위라 **같은 정보를 문서마다 따로 입력**, 다른 문서에 전파 안 됨
4. PATCH가 파일 전체를 LLM 출력으로 교체 → 기존/수정한 답변이 바뀔 위험(프롬프트 지시에만 의존)
5. 검토 화면에서 답변을 직접 수정할 방법 없음

**해결**
| # | 변경 | 위치 |
|---|---|---|
| 1 | DB 컬럼 분리: 구조 `formDraftJson` / 결과 `draftOutputJson` / 입력 `userInputJson` (마이그레이션 추가) | `prisma/schema.prisma` |
| 2 | 생성 시 3개 모두 저장 (구조는 더 이상 덮어쓰지 않음) | `app/api/ai/irb-form-draft/route.ts` (POST) |
| 3 | 검토 화면: 같은 정보(`answerKey`)를 요구하는 누락 문항을 **입력란 1개**로 묶고 적용 문서 표시 | `ReviewClient.tsx`, `lib/irb/draftStore.ts` |
| 4 | 보완(PATCH): 입력 병합 저장 → **같은 키를 쓰는 모든 파일의 누락 문항만** AI 재생성(자연어+전체 입력 재전달) → 대상 문항만 교체 (코드 레벨 보존) | `route.ts` (PATCH) |
| 5 | 답변 **직접 수정** 기능 + 저장 API (수정한 답은 보완 때 건드려지지 않음) | `ReviewClient.tsx`, `app/api/projects/[id]/draft/route.ts` |
| 6 | 워크스페이스로 돌아오면 **재업로드 없이** 이전 입력이 채워진 상태로 표시 | `workspace/page.tsx`, `IRBFormDraftPanel.tsx`, `IRBDynamicForm.tsx` |
| 7 | HWPX 내보내기가 새 저장 구조를 읽도록 연동 (예전 프로젝트 형태도 호환) | `app/api/export/route.ts` |
| 8 | 보충 입력 후 새로고침 없이 화면 즉시 반영 | `ReviewClient.tsx` |

- 예전 프로젝트(formDraftJson에 결과가 덮어써진 형태)도 읽을 수 있게 호환 처리함 (`parseStoredDraft`의 legacy 경로).

### C. 문서
- `docs/TODO_01.md`: 친구 질문 분석 + 결정 + 완료 처리
- `docs/WORK_REPORT_2026-11-06.md`: 이 문서

---

## 2. 검증 결과

| 항목 | 결과 |
|---|---|
| 신규 테스트 22개 (`fillHwpx` 7, `draftStore` 9, `patchRoute` 6) | **전부 통과** |
| 전체 테스트 | 53개 중 **49 통과 / 4 실패** |
| 실패 4개 | `landing`(jest-dom 매처 설정), `auth.property`(bcrypt) — **이번 작업 이전부터 실패**하던 기존 테스트. 이번 변경과 무관 |
| `tsc --noEmit` | 변경한 파일 오류 없음 (기존 테스트 파일의 jest-dom 타입 오류만 남음) |
| `next build` | 성공 |

검증한 핵심 동작 (`__tests__/patchRoute.test.ts`, AI·DB는 가짜로 대체)
- 같은 정보를 쓰는 **두 문서의 누락 항목이 함께 채워짐**
- 사용자가 고친 답변 / 무관한 누락 항목은 **그대로 보존**
- 병합된 입력과 **원래 자연어 설명이 AI 프롬프트에 다시 전달됨**
- AI가 엉뚱하게 응답해도 사용자 입력이 안전망으로 사용됨
- 생성 후 **문항 구조가 덮어써지지 않고** 3개 컬럼에 각각 저장됨
- 예전 프로젝트 형태에서도 보완 가능

### ⚠ 검증하지 못한 것 (솔직하게)
1. **실제 Luxia AI 호출로 끝까지 돌려보지 않았다.** AI 부분은 가짜 응답으로만 검증했다. 실제 응답 품질/형식 파싱은 직접 확인 필요.
2. **실제 기관 HWPX 양식으로 검증하지 못했다.** 가상으로 만든 HWPX에서만 통과. 양식마다 표 구조가 달라 칸 위치가 어긋날 수 있고, **한글(HWP)에서 열리는지도 미확인**.
3. 브라우저 화면(검토 화면 UI)을 눈으로 확인하지 못했다. 타입/빌드/로직 테스트까지만 확인.

---

## 3. 커밋 / 푸시 내역
| 커밋 | 내용 |
|---|---|
| `b7ee01f` | feat: export filled HWPX based on uploaded institution template |
| (이번) | feat: persist draft structure/user input, group missing info across files, patch only missing items |

푸시 대상: `origin/main` — 푸시 때 "레포가 `https://github.com/HwanHeeYOU/2026_GraduationProject.git`로 이동했다"는 안내가 떴다. 지금은 옛 주소도 동작하지만 새 주소로 바꾸는 걸 권장:
```
git remote set-url origin https://github.com/HwanHeeYOU/2026_GraduationProject.git
```
(커밋하지 않은 개인 문서 `9월22일_면담교수님자료.pdf`, `Graduation_Project_Midterm_Report_Oct17_Final.docx`는 의도적으로 제외)

---

## 4. 친구가 해야 할 일 (TODO)

### 4-1. 받자마자 (필수, 순서대로)
1. 돌아가는 `npm run dev` **먼저 끄기** (안 끄면 prisma 에러)
2. `git pull`
3. `npm install`
4. `npm run db:migrate` — **마이그레이션 2개** 적용됨
   - `add_project_template_file` (HWPX 원본 저장 테이블)
   - `split_draft_storage` (Project에 `draftOutputJson`, `userInputJson` 컬럼 추가)
   - `DATABASE_URL not found`가 뜨면 `.env`에 `DATABASE_URL="file:./prisma/irb_master.db"` 한 줄 추가 (Prisma CLI는 `.env.local`을 안 읽음)
5. `npm run dev`
6. `.env.local`에 `AI_PROVIDER="luxia"`, `LUXIA_API_KEY` 확인

### 4-2. 직접 확인해 줘야 하는 것 (내가 못 한 검증)
- [ ] **실제 기관 양식(.hwpx)으로 HWPX 다운로드** → 한글에서 열리는지, 답변이 맞는 칸에 들어갔는지, 안 맞으면 어떤 양식 구조인지 알려주기
- [ ] **실제 Luxia로 전체 흐름**: 양식 업로드 → 자연어 입력 → 초안 생성 → 검토 화면 → 추가 정보 입력 → "보완 후 최종 검토"
  - 같은 정보가 필요한 여러 문서에 **한 번 입력으로 같이 채워지는지**
  - 이미 채워진/직접 수정한 답이 **안 바뀌는지**
  - 워크스페이스로 돌아갔을 때 **재업로드 없이 입력값이 남아 있는지**
- [ ] 검토 화면 UI(입력란 묶음, "직접 수정" 버튼)가 어색하지 않은지 눈으로 확인

### 4-3. 기존 프로젝트 주의
- 예전에 만든 프로젝트는 **원본 양식이 저장돼 있지 않아서** HWPX 내보내기를 쓰려면 양식 `.hwpx`를 **다시 업로드**해야 한다.
- 예전 프로젝트는 문항 구조도 없어서 워크스페이스는 업로드부터 시작한다(검토 화면 보완은 가능). **새로 만든 프로젝트부터 완전한 흐름**이 동작한다.

---

## 5. 남은 TODO (이번에 안 한 것)
우선순위 높음 → 낮음
1. **실제 양식 기반 HWPX 보정**: 표 구조가 다른 양식에서 칸 매칭 실패 시 규칙 보강 (현재는 문서 끝에 모아 붙이는 안전망)
2. **모듈 카드 내용 / `sourceSummary`가 초안 생성에 안 쓰임**: 워크스페이스 모듈 카드에 직접 쓴 내용과 문서 분석 요약이 AI 생성에 전혀 반영되지 않음. 반영하거나 UI를 정리해야 함. (`/api/ai/summarize-modules`는 호출하는 곳이 없음)
3. **기존 실패 테스트 4개 정리**: `landing`(jest-dom 설정 누락), `auth.property`(bcrypt 시간 초과 추정)
4. **HWPX 파서 중복 제거**: `analyze-irb-file`과 `irb-form-draft`에 파싱 코드가 따로 있고, 후자는 `hp:t`만 처리 (전자는 여러 네임스페이스 지원)
5. `.hwp`(구형) 내보내기/파싱 불안정 (`@hwp.js/parser` 알파 버전)
6. 문서 분석 시 앞 8000자만 사용 → 긴 양식은 뒤쪽 문항 누락 가능
7. 워크스페이스 재생성 시 전 문항을 다시 만드는 비용 (복귀 경로는 아직 전체 재생성. 검토 화면 보완 경로는 누락분만)
8. `npm audit` 취약점 29개 (심각 5) — `--force`로 고치면 깨질 수 있어 개별 검토 필요
9. ESLint 미설정 (`next lint`가 대화형 설정을 요구함)
10. 레포 주소 이동 반영 (`git remote set-url`, 위 3번 참고)
11. 설치된 `@anthropic-ai/sdk`가 `^0.27.0`으로 오래됨 (Luxia만 쓰면 영향 없음)

---

## 6. 변경 파일 요약
**신규**: `lib/export/fillHwpx.ts`, `lib/irb/draftStore.ts`, `app/api/projects/[id]/templates/route.ts`, `app/api/projects/[id]/draft/route.ts`, `__tests__/{fillHwpx,draftStore,patchRoute}.test.ts`, `prisma/migrations/*` 2개, `docs/TODO_01.md`, `docs/WORK_REPORT_2026-11-06.md`
**수정**: `prisma/schema.prisma`, `lib/irb/types.ts`, `app/api/ai/irb-form-draft/route.ts`, `app/api/export/route.ts`, `app/projects/[id]/{review,workspace}/page.tsx`, `components/review/{ReviewClient,ExportButton}.tsx`, `components/workspace/{WorkspaceClient,IRBFormDraftPanel,IRBDynamicForm}.tsx`, `components/projects/NewProjectWizard.tsx`, `package.json`, `package-lock.json`
