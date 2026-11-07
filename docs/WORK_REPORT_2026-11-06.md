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
1. 실제 양식 기반 HWPX 보정
→ [타협 및 우회] 다중 열 표 분할 삽입 등 완벽한 구현은 XML 구조상 한계가 있어, 복잡한 표는 라벨 옆 빈칸에 욱여넣거나 위치를 못 찾으면 문서 맨 끝에 모아 붙이는 안전망(Fallback) 로직으로 타협함. (필요시 사용자가 원본 한글 양식에서 셀을 병합한 뒤 업로드하는 워크어라운드 사용)

2. 모듈 카드 내용 / sourceSummary가 초안 생성에 안 쓰임
→ [해결 완료] KIRO를 통해 API(irb-form-draft) 데이터 흐름을 수정하여, 초안 생성 시 사용자가 워크스페이스 모듈에 작성한 메모와 문서 요약본이 AI 시스템 프롬프트(Context)에 최우선 근거(Ground Truth)로 강제 주입되도록 연동 완료함. (테스트 결과 사용자의 구체적인 작성 의도가 폼 답변에 정확히 생성됨을 확인)

3. 기존 실패 테스트 4개 정리
→ [대기 중] 아직 손대지 않음. 로직 구현이 다 끝나면 jest-dom 매처 설정 추가 및 bcrypt 타임아웃 문제를 해결하여 테스트를 통과시켜야 함.

4. HWPX 파서 중복 제거
→ [대기 중] 아직 손대지 않음. 현재 analyze-irb-file과 irb-form-draft API에 각각 흩어져 있는 텍스트 추출(파싱) 코드를 하나의 공통 함수로 묶어 유지보수성을 높이는 리팩토링이 필요함.

5. .hwp(구형) 내보내기/파싱 불안정
→ [정책적 해결] 구형 파서 라이브러리(@hwp.js/parser) 자체의 알파 버전 한계이므로 코드로 억지로 고치지 않음. 사용자에게 최신 포맷인 .hwpx나 .docx로 변환해서 올리도록 가이드하는 정책으로 완전히 우회함.

6. 문서 분석 시 앞 8000자만 사용
→ [해결 완료] KIRO를 통해 코드의 잘림(slice) 제한을 40,000자 이상으로 대폭 늘려, 이력서 등 긴 문서의 뒷부분에 있는 문항이 누락되는 현상을 완벽히 고침.

7. 워크스페이스 재생성 시 전 문항을 다시 만드는 비용
→ [대기 중] 아직 손대지 않음. 초안을 다시 짤 때 전 문항을 전부 다시 만들면 토큰(비용) 낭비가 심하므로, 최종 검토 화면처럼 누락된 항목만 핀포인트로 재생성하도록 로직 최적화가 필요함.

8. npm audit 취약점 29개 (심각 5)
→ [대기 중] 당장 서버가 죽는 에러는 아니므로 방치 중. --force로 덮어씌우면 다른 의존성이 깨질 위험이 크므로, 기능 개발이 모두 끝난 뒤 안정화 단계에서 패키지를 하나씩 수동 점검해야 함.

9. ESLint 미설정
→ [대기 중] 터미널에서 next lint 명령어를 한 번 실행해서 대화형 초기 세팅만 잡아주면 됨.

10. 레포 주소 이동 반영
→ [해결 완료] 친구가 알려준 대로 로컬 터미널에서 git remote set-url origin [https://github.com/HwanHeeYOU/2026_GraduationProject.git](https://github.com/HwanHeeYOU/2026_GraduationProject.git) 명령어를 쳐서 새 깃허브 주소로 연결을 업데이트함.

11. 설치된 @anthropic-ai/sdk가 오래됨
→ [무시/보류] 현재 학교 지원을 받아 룩시아(Luxia) API를 메인으로 사용하고 있으므로, 클로드 SDK 버전이 낮은 것은 앱 구동에 아무런 지장을 주지 않아 일단 무시함.

**한계점 존재**
복잡한 다중 열 표(Multi-column Grid)의 HWPX 동적 분할 삽입 한계

현상: 이력서의 '근무 경력', '학력' 등 1개의 문항이 여러 열(기간, 학교, 직위 등)로 쪼개져 있는 다중 표 양식의 경우, 폼에서 입력한 여러 줄의 텍스트 덩어리를 각각의 셀 구조에 맞게 동적으로 분할하여 삽입하지 못함.

원인: 현재 HWPX 주입 코드(fillHwpx.ts)는 라벨(문항명) 기준 1:1 단일 셀 매칭 로직을 사용함. 다중 입력값을 처리하기 위해 XML의 RowSpan, ColSpan 속성을 동적으로 찢고 재구성하는 작업은 구현 복잡도가 매우 높으며, 자칫 기관의 원본 문서 서식을 심각하게 훼손할 위험이 있음.

현재 조치 (Fallback 적용): 원본 IRB 양식을 안전하게 보호하기 위해, 복잡한 표 구조에서 매칭에 실패한 답변은 무리하게 끼워 넣지 않음. 대신 문서 최하단에 ※ 양식에서 위치를 찾지 못한 항목으로 모아서 안전하게 출력되도록 방어 로직(Fail-safe)을 적용하여 타협함.
---

## 6. 변경 파일 요약
**신규**: `lib/export/fillHwpx.ts`, `lib/irb/draftStore.ts`, `app/api/projects/[id]/templates/route.ts`, `app/api/projects/[id]/draft/route.ts`, `__tests__/{fillHwpx,draftStore,patchRoute}.test.ts`, `prisma/migrations/*` 2개, `docs/TODO_01.md`, `docs/WORK_REPORT_2026-11-06.md`
**수정**: `prisma/schema.prisma`, `lib/irb/types.ts`, `app/api/ai/irb-form-draft/route.ts`, `app/api/export/route.ts`, `app/projects/[id]/{review,workspace}/page.tsx`, `components/review/{ReviewClient,ExportButton}.tsx`, `components/workspace/{WorkspaceClient,IRBFormDraftPanel,IRBDynamicForm}.tsx`, `components/projects/NewProjectWizard.tsx`, `package.json`, `package-lock.json`
