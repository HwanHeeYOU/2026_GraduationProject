import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateText, isLuxiaProvider } from '@/lib/ai-client'
import type {
  IRBFormDraftResult, IRBFormDraftOutput, IRBFormQuestion, IRBUserAnswers, IRBUserInput,
} from '@/lib/irb/types'
import {
  MISSING_MARKER,
  isMissing,
  parseStoredDraft,
  mergeSupplements,
  findPatchTargets,
  applyAnswers,
  buildRawText,
} from '@/lib/irb/draftStore'
import { buildProjectContext } from '@/lib/irb/projectContext'
import { fitNaturalInput } from '@/lib/irb/naturalInput'
import { verifyAnswer } from '@/lib/irb/grounding'

export const maxDuration = 120

/** DB 에서 프로젝트의 문서 요약본 + 모듈 카드 내용을 읽어 프롬프트용 컨텍스트 문자열로 만든다. */
async function loadProjectContext(projectId: string | undefined, userId: string): Promise<string> {
  if (!projectId) return ''
  try {
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: {
        sourceSummary: true,
        modules: {
          select: { content: true, module: { select: { name: true } } },
          orderBy: { order: 'asc' },
        },
      },
    })
    return buildProjectContext(project)
  } catch (e) {
    // 컨텍스트 조회 실패가 초안 생성을 막지 않도록 — 로그만
    console.warn('[irb-form-draft] project context load failed:', e)
    return ''
  }
}

const MAX_FILE_SIZE = 10 * 1024 * 1024

// ── 파일 텍스트 추출 ──────────────────────────────────────────
async function extractText(name: string, buffer: Buffer): Promise<string | null> {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'txt') return buffer.toString('utf-8').trim() || null
  if (ext === 'docx') {
    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      return result.value?.trim() || null
    } catch { return null }
  }
  if (ext === 'hwp') {
    try {
      const { parseHwpStructure, structureToText } = await import('@/lib/hwp/hwpToHwpx')
      return structureToText(await parseHwpStructure(buffer)) || null
    } catch { return null }
  }
  if (ext === 'hwpx') {
    // 표를 행 단위로, 파란 글씨(작성 예시)는 〔예시〕 로 표시해서 읽는다. 실패하면 아래 단순 추출로 폴백.
    try {
      const { hwpxToText } = await import('@/lib/hwp/hwpxText')
      const structured = await hwpxToText(buffer)
      if (structured) return structured
    } catch (e) {
      console.warn('[irb-form-draft] structured hwpx extraction failed, falling back:', e instanceof Error ? e.message : e)
    }
    try {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(buffer)
      const secs = Object.keys(zip.files)
        .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
        .sort((a, b) => Number(a.match(/(\d+)/)?.[1]) - Number(b.match(/(\d+)/)?.[1]))
      const texts: string[] = []
      for (const n of secs) {
        const xml = await zip.files[n].async('text')
        for (const m of xml.matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g)) {
          const d = m[1]
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
          if (d.trim()) texts.push(d.trim())
        }
      }
      return texts.join('\n').trim() || null
    } catch { return null }
  }
  return null
}

// ── Phase 1-A: 파일 하나에서 raw 문항 추출 ───────────────────
// 문서를 앞부분만 자르지 않고 줄 단위 청크로 나눠 전부 분석한다.
const RAW_CHUNK_SIZE = 15000      // 청크 하나의 최대 글자 수
const RAW_CHUNK_OVERLAP = 1000    // 청크 경계에서 표 헤더가 끊기지 않도록 겹치는 글자 수
const RAW_MAX_TOTAL = 300000      // 파일 하나당 분석 상한 (비정상적으로 큰 입력 방어)
const RAW_CONCURRENCY = 3         // 동시에 보낼 AI 요청 수

function splitIntoChunks(text: string): string[] {
  const src = text.length > RAW_MAX_TOTAL ? text.slice(0, RAW_MAX_TOTAL) : text
  if (src.length <= RAW_CHUNK_SIZE) return [src]
  const lines = src.split('\n')
  const chunks: string[] = []
  let cur: string[] = []
  let len = 0
  for (const line of lines) {
    if (len + line.length + 1 > RAW_CHUNK_SIZE && cur.length > 0) {
      chunks.push(cur.join('\n'))
      // 끝부분 일부를 다음 청크 앞에 다시 붙인다 (표 헤더/문맥 유지)
      const tail: string[] = []
      let tailLen = 0
      for (let i = cur.length - 1; i >= 0 && tailLen < RAW_CHUNK_OVERLAP; i--) {
        tail.unshift(cur[i])
        tailLen += cur[i].length + 1
      }
      cur = tail
      len = tailLen
    }
    // 줄 하나가 청크보다 길면 강제로 분할
    if (line.length > RAW_CHUNK_SIZE) {
      for (let i = 0; i < line.length; i += RAW_CHUNK_SIZE) {
        chunks.push(line.slice(i, i + RAW_CHUNK_SIZE))
      }
      cur = []
      len = 0
      continue
    }
    cur.push(line)
    len += line.length + 1
  }
  if (cur.length > 0) chunks.push(cur.join('\n'))
  return chunks
}

function buildRawExtractionPrompt(fileName: string, text: string, part = 1, total = 1): string {
  const partNote = total > 1
    ? `\n※ 이 파일은 길어서 ${total}개 구간으로 나눠 분석합니다. 지금은 ${part}/${total} 구간입니다. 이 구간에 있는 문항만 추출하세요. (구간 앞부분은 이전 구간과 일부 겹칠 수 있습니다)\n`
    : ''
  return `당신은 IRB(기관생명윤리위원회) 서류 분석 전문가입니다.
아래 IRB 서류/양식 파일을 정밀하게 분석하여, 사용자가 실제로 작성·입력해야 할 모든 문항을 누락 없이 추출하세요.
${partNote}
=== 파일: ${fileName} ===
${text}

추출 규칙:
- 빈칸, 입력란, 서술 요청, 체크박스 항목 등 사용자가 채워야 할 모든 항목 포함
- 섹션 제목이나 안내문(작성 방법 설명)은 제외
- 표 형태의 양식도 각 셀의 입력 항목을 문항으로 추출
- 문항 텍스트는 원본 언어 그대로 유지 (한국어라면 한국어로)

★★ 여러 행을 입력하는 표(Table) 문항 — 절대 생략 금지 ★★
- 다음 중 하나라도 해당하면 "여러 행을 입력하는 표"입니다. "필요시 칸을 추가하여 기재" 같은 문구가 없어도 마찬가지입니다.
  ① "필요시 칸을 추가하여 기재하십시오", "행을 추가하여 작성" 등의 문구가 있다
  ② 열 이름이 적힌 머리글 행 아래에 비어 있거나 작성 예시만 적힌 같은 모양의 행이 둘 이상 이어진다
     (예: "구분 | 내역 | 예산액 | 비고" 아래에 "1 | … | | …", "2 |  |  | " … 같은 행이 이어지는 지출내역·예산표)
  예: 이력서의 학력, 근무 경력, 연구 경력, 교육이수이력, 연구 참여 이력, 자격·면허 사항, 연구비 지출내역 등
- 이런 표는 표의 헤더(예: 기간, 소속, 직위, 연구 제목, 교육명, 구분, 내역, 예산액, 비고 등)를 파악하여,
  하나의 문항으로 추출하되 문항 텍스트에 표 이름과 열 이름을 모두 포함하세요.
  형식: "표 이름 (열1 / 열2 / 열3 …) - 여러 건 입력"
  예: "근무 경력 (기간 / 소속 / 직위 / 담당업무) - 여러 건 입력"
  예: "교육이수이력 (교육명 / 이수일 / 교육기관 / 시간) - 여러 건 입력"
  예: "지출내역 (내역 / 예산액 / 비고) - 여러 건 입력"  ← 머리글이 "구분 | 내역 | 예산액 | 비고"이고 "구분" 칸에 1, 2, 3 번호가 미리 인쇄돼 있는 경우
- 머리글 아래 행의 어떤 열에 1, 2, 3 … 처럼 번호가 미리 인쇄돼 있으면 그 열(머리글이 "구분", "번호", "No." 등)은 번호 열입니다. 사용자가 채우는 열이 아니므로 열 이름 목록에서 빼세요.
- 표 이름은 표 바로 위 제목에서 번호("2.")와 단위 표기("(단위 : 원)")를 뺀 것을 사용하세요.
- 사용자가 여러 개의 항목(행)을 배열처럼 반복해서 입력할 수 있어야 하므로, 헤더 열 이름을 절대 빠뜨리거나 표 이름만 덩그러니 적고 생략하지 마세요.
- 빈 행이 여러 개 있어도 행마다 별도 문항으로 만들지 말고, 표 하나당 문항 하나로 추출하세요.
- "총 계"·"합계" 줄은 열 이름이 아닙니다. 사용자가 채울 표 문항에 포함하지 마세요.

★★ 작성 예시 표시 〔예시〕 ★★
- 문서 안에서 〔예시〕 로 시작하는 글은 양식에 파란 글씨로 적힌 작성 예시·안내 문구입니다. 사용자가 채울 문항이 아니므로 문항으로 추출하지 마세요.
- 다만 예시를 보고 그 칸이 무엇을 쓰는 곳인지, 표의 열이 무엇인지 파악하는 데에는 활용하세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트나 마크다운 없이 순수 JSON만:
{
  "fileName": "${fileName}",
  "items": [
    { "question": "연구 제목" },
    { "question": "연구책임자 성명" },
    { "question": "연구 배경 및 목적" }
  ]
}`
}

// ── Phase 1-B: LLM 기반 의미 중복 통합 ──────────────────────
function buildDeduplicationPrompt(
  perFileItems: { fileName: string; questions: string[] }[]
): string {
  const filesSummary = perFileItems
    .map((f) => {
      const qList = f.questions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')
      return `[파일: ${f.fileName}]\n${qList}`
    })
    .join('\n\n')

  return `당신은 IRB 서류 통합 전문가입니다.
아래는 여러 IRB 파일에서 추출한 문항 목록입니다. 의미가 같거나 유사한 문항들을 하나로 병합하여, 사용자가 한 번만 입력하면 되는 통합 질문 목록을 만드세요.

${filesSummary}

병합 규칙:
- 표현이 달라도 묻는 내용이 동일하면 반드시 하나로 통합 (예: "연구 제목", "과제명", "연구 과제 제목" → "연구 제목")
- 통합 문항의 label은 가장 포괄적이고 명확한 표현을 사용
- 완전히 다른 내용을 묻는 문항은 각각 별도 항목으로 유지
- 각 통합 문항이 원본에서 어떤 표현들을 합쳤는지 variants에 모두 기록
- "(열1 / 열2 …) - 여러 건 입력" 형태의 여러 행 표 문항(근무 경력, 연구 경력, 교육이수이력 등)은 절대 삭제하거나 다른 문항에 흡수하지 말고, 열 이름을 유지한 채 별도 항목으로 두며 multiline을 true로 설정

출력 후 각 원본 파일의 각 문항이 통합 목록의 어떤 key에 해당하는지 매핑도 제공하세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트나 마크다운 없이 순수 JSON만:
{
  "mergedQuestions": [
    {
      "key": "q_0",
      "label": "연구 제목",
      "multiline": false,
      "variants": ["연구 제목", "과제명", "연구 과제 제목"]
    },
    {
      "key": "q_1",
      "label": "연구책임자 성명",
      "multiline": false,
      "variants": ["연구책임자 성명", "연구자 이름"]
    }
  ],
  "fileMappings": [
    {
      "fileName": "파일명1.docx",
      "items": [
        { "originalQuestion": "연구 제목", "mergedKey": "q_0" },
        { "originalQuestion": "연구책임자 성명", "mergedKey": "q_1" }
      ]
    }
  ]
}`
}

// ── Phase 3: 지능형 매핑 및 초안 생성 (청크 단위) ──────────────
// 한 번에 처리할 최대 문항 수. 프로젝트 컨텍스트가 붙으면 프롬프트가 길어져 Luxia 응답이 100초를 넘기고
// ECONNRESET 이 나므로, 호출 한 번이 30초 안에 끝나도록 작게 나눈다.
const CHUNK_SIZE = 5

function buildMappingPrompt(
  fileName: string,
  chunkItems: { question: string; answerKey: string }[],
  mergedQuestions: IRBFormQuestion[],
  userAnswers: IRBUserAnswers,
  naturalLanguageInput: string,
  projectContext = '',
): string {
  // 이 청크에 직접 답변이 있는 항목
  const directAnswers = chunkItems
    .filter((item) => userAnswers[item.answerKey]?.trim())
    .map((item) => `[문항] ${item.question}\n[직접 입력값] ${userAnswers[item.answerKey]}`)
    .join('\n\n')

  // 전체 개별 입력 컨텍스트 (추론 근거용 — 다른 청크 포함)
  const globalContext = mergedQuestions
    .filter((q) => userAnswers[q.key]?.trim())
    .map((q) => `• ${q.label}: ${userAnswers[q.key]}`)
    .join('\n')

  const hasNaturalInput = naturalLanguageInput.trim().length > 0
  const hasDirectAnswers = directAnswers.length > 0

  // 이 청크의 문항 목록
  const questionList = chunkItems
    .map((item, i) => {
      const direct = userAnswers[item.answerKey]?.trim()
      return direct
        ? `${i + 1}. ${item.question}  ← 직접 입력값 있음`
        : `${i + 1}. ${item.question}`
    })
    .join('\n')

  const contextBlock = projectContext
    ? `=== [프로젝트 컨텍스트 — 최우선 사실(Ground Truth)] ===
${projectContext}
=== [프로젝트 컨텍스트 끝] ===

★★ 최우선 규칙 — Ground Truth ★★
- 위 "프로젝트 컨텍스트"(문서 분석 요약본, 사용자가 모듈 카드에 직접 작성한 내용)는 사용자가 제공한 확정 사실입니다. 모든 문항의 답변은 이 내용을 가장 먼저, 최우선 근거로 삼아 작성하세요.
- 컨텍스트에 있는 정보(연구 제목, 대상자, 방법, 기간, 책임자, 소속 등)는 반드시 해당 문항에 반영하고, 이와 모순되는 내용을 만들어내지 마세요.
- 컨텍스트에 없는 사실을 임의로 지어내지 마세요. 컨텍스트와 아래 입력 어디에도 근거가 없을 때만 ${MISSING_MARKER}를 사용하세요.
- 컨텍스트는 아래 직접 입력값/자연어 설명을 보완하는 근거입니다. 같은 항목이 서로 다르면 "직접 입력값"이 가장 우선입니다.

`
    : ''

  return `${contextBlock}[시스템 지침 — 절대 준수]
당신은 IRB 서류 작성 전문가입니다.

★★ 가장 중요한 규칙 — 입력에 없는 내용은 절대 쓰지 않는다 ★★
이 문서는 IRB(기관생명윤리위원회) 제출 서류입니다. 사실과 다른 내용이 한 글자라도 섞이면 안 됩니다.
- 답변은 아래 "직접 입력값", "프로젝트 컨텍스트", "자연어 연구 설명", "개별 입력된 전체 답변"에 **실제로 적혀 있는 사실만** 근거로 씁니다.
- 입력에 없는 내용을 추측·일반화·통상적인 관행·모범답안·예시로 만들어 채우는 것은 **절대 금지**입니다.
  특히 금액, 인원, 횟수, 기간, 날짜, 기관명, 연락처, 모집·동의·연구 절차, 선정·제외·중지·탈락 기준, 보관·폐기 방법, 위험·이익·보상·사례비 내용을 지어내지 마세요.
- 문항에 대한 근거 문장이 입력에 없으면 답변은 ${MISSING_MARKER} 한 줄만 쓰세요. 비워 두는 것이 지어내는 것보다 훨씬 낫습니다.
- 입력의 표현을 가능한 한 그대로 쓰고, 문장을 길게 풀어 쓰며 새 내용을 덧붙이지 마세요. 연구 제목만 있다고 연구 배경·목적·방법을 서술하지 마세요.
- 다른 문항의 답에서 가져오는 것은 그 값이 이 문항에 그대로 해당할 때만 허용됩니다 (예: "소속기관명" ← 입력된 소속). 새 사실을 추론해 붙이지 마세요.
- 입력 문장을 쓰더라도 **그 문장이 이 문항이 묻는 것에 직접 답할 때만** 쓰세요. 비슷한 단어가 들어 있다고 다른 주제의 문장을 옮겨 오지 마세요.
  잘못된 예: "관찰 항목"에 위험 설명("일시적인 피로감")을 쓰기, "제공기관"에 연구자 소속기관을 쓰기, "자료 보관 방법"에 동의 철회 시 처리 내용을 쓰기 → 이런 경우는 ${MISSING_MARKER}
- 양식의 안내문·예시 문구를 답으로 베끼지 마세요.

답변 방법:
- "← 직접 입력값 있음" 표시된 문항은 직접 입력값을 그대로 사용
- 그 외에는 자연어 연구 설명·프로젝트 컨텍스트에서 해당 문항에 정확히 해당하는 정보를 찾아 사용
   예시: "연구 제목은 X입니다" → "연구 제목" 문항에 X 사용
   예시: "Z 대학교 소속입니다" → "소속 기관" 문항에 Z 대학교 사용
- 근거가 되는 정보가 입력에 없으면 ${MISSING_MARKER}

${hasDirectAnswers ? `=== 직접 입력값 (반드시 그대로 사용) ===
${directAnswers}

` : ''}${globalContext ? `=== 개별 입력된 전체 답변 (근거로 쓸 수 있음) ===
${globalContext}

` : ''}${hasNaturalInput ? `=== 자연어 연구 설명 (여기 적힌 사실만 근거로 사용) ===
${fitNaturalInput(naturalLanguageInput, chunkItems.map((i) => i.question))}

` : ''}=== [파일: ${fileName}] 아래 ${chunkItems.length}개 문항에 순서대로 답변하세요 ===
${questionList}

출력 규칙:
- 답변 형식 (가독성):
  - " | " 기호는 어떤 답변에도 절대 쓰지 마세요. 여러 건·여러 항목은 반드시 줄을 바꿔 쓰세요.
  - " / " 기호로 여러 문장이나 항목을 한 줄에 이어 붙이지 마세요. " / "는 아래 표 문항(문항 텍스트에 " / "가 들어 있는 문항)의 열 구분에만 씁니다.
  - 연구절차, 관찰 항목, 통계적 분석 방법처럼 여러 단계·항목이 있으면 한 단계·항목당 한 줄로, 줄 앞에 번호("1. ", "2. ") 또는 글머리 기호("- ")를 붙여 쓰세요.
    예)
    1. 연구 설명 및 서면 동의
    2. 사전 실행기능 검사
    3. 8주간 작업기억 훈련
  - 답변 안에 소항목 제목(예: "1) 연구절차", "2) 관찰 항목")을 쓸 때는 제목을 한 줄로 따로 쓰고, 그 내용은 다음 줄부터 쓰세요. 소항목과 소항목 사이에는 빈 줄을 하나 넣으세요.
  - 한 문장으로 끝나는 답(성명, 소속, 기간 등)은 한 줄로 쓰세요.
- "(열1 / 열2 …) - 여러 건 입력" 형태의 표 문항, 또는 "공동연구자 성명 / 소속 / 직위"처럼 문항 텍스트에 " / "로 열 이름이 들어 있는 문항은 입력된 정보에서 여러 건을 찾아 **한 건당 한 줄**로, 열 순서대로 " / "로 구분하여 작성 (예: "2020.03~2023.02 / ○○병원 / 전임의 / 임상연구")
  각 줄 앞에 번호를 붙이지 말고, 건과 건 사이는 " | "가 아니라 줄바꿈으로 구분. 정보가 일부만 있어도 있는 건만 작성. 건이 하나도 없을 때만 ${MISSING_MARKER}
- 마크다운, 인사말, 설명 없이 아래 형식만 출력
- 반드시 ${chunkItems.length}개 문항 전부, 순서대로 출력
- [문항] 뒤에는 원본 문항 텍스트를 그대로 복사 (절대 요약하거나 변경하지 말 것)
- [답변] 뒤에는 입력에 근거한 답변, 근거가 없으면 "${MISSING_MARKER}"
- [근거] 뒤에는 답변의 근거가 된 **입력 원문을 글자 그대로** 인용하세요 (요약·바꿔 쓰기 금지, 여러 곳이면 " | "로 구분). 입력에 그런 문장이 없으면 답변을 쓰지 말고 [답변]에 ${MISSING_MARKER}, [근거]에 "없음"을 쓰세요.

출력 형식:
[파일: ${fileName}]
[문항] 원본문항텍스트
[답변] 답변내용
[근거] 입력에서 그대로 가져온 원문`
}

// ── Phase 3 결과 파싱 (퍼지 매칭 포함) ──────────────────────────
interface ParsedItem { question: string; answer: string; evidence: string }

function parseFileOutput(raw: string): ParsedItem[] {
  const items: ParsedItem[] = []
  const parts = raw.split(/\[문항\]/).slice(1)
  for (const part of parts) {
    const [questionPart, ...answerParts] = part.split(/\[답변\]/)
    const question = (questionPart ?? '').trim()
    // [답변] 뒤에서 [근거] 를 떼어 낸다 (답변 안에 "[근거]" 글자가 또 나와도 첫 번째만 구분자로 본다)
    const answerAndEvidence = (answerParts.join('[답변]') ?? '').trim()
    const evIdx = answerAndEvidence.search(/\[근거\]/)
    const answer = (evIdx >= 0 ? answerAndEvidence.slice(0, evIdx) : answerAndEvidence).trim()
    const evidence = evIdx >= 0 ? answerAndEvidence.slice(evIdx + 4).trim() : ''
    if (question) items.push({ question, answer: answer || MISSING_MARKER, evidence })
  }
  return items
}

// 파싱된 문항 텍스트와 원본 문항 텍스트를 매칭 (퍼지)
function matchParsedToOriginal(
  parsed: ParsedItem[],
  original: string
): ParsedItem | undefined {
  const origNorm = original.trim().toLowerCase().replace(/\s+/g, ' ')

  // 1. 정확히 일치
  const exact = parsed.find((p) => p.question.trim().toLowerCase().replace(/\s+/g, ' ') === origNorm)
  if (exact) return exact

  // 2. 원본이 파싱 문항을 포함하거나, 파싱 문항이 원본을 포함
  const contains = parsed.find((p) => {
    const pNorm = p.question.trim().toLowerCase().replace(/\s+/g, ' ')
    return origNorm.includes(pNorm) || pNorm.includes(origNorm)
  })
  if (contains) return contains

  // 3. 자카드 유사도 0.6 이상
  const ngrams = (s: string, n = 2) => {
    const set = new Set<string>()
    for (let i = 0; i <= s.length - n; i++) set.add(s.slice(i, i + n))
    return set
  }
  let bestScore = 0.6
  let bestItem: ParsedItem | undefined
  for (const p of parsed) {
    const pNorm = p.question.trim().toLowerCase().replace(/\s+/g, ' ')
    const sa = ngrams(origNorm)
    const sb = ngrams(pNorm)
    if (sa.size === 0 && sb.size === 0) continue
    let inter = 0
    for (const g of sa) if (sb.has(g)) inter++
    const score = inter / (sa.size + sb.size - inter)
    if (score > bestScore) { bestScore = score; bestItem = p }
  }
  return bestItem
}

// ── 유사도 기반 중복 통합 폴백 ──────────────────────────────
function normalizeQ(q: string): string {
  return q.trim().toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]【】:：·•\-]/g, '')
}

// 두 문자열의 자카드 문자 n-gram 유사도 (0~1)
function jaccardSimilarity(a: string, b: string, n = 2): number {
  const ngrams = (s: string) => {
    const set = new Set<string>()
    for (let i = 0; i <= s.length - n; i++) set.add(s.slice(i, i + n))
    return set
  }
  const sa = ngrams(a)
  const sb = ngrams(b)
  if (sa.size === 0 && sb.size === 0) return 1
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const g of sa) if (sb.has(g)) inter++
  return inter / (sa.size + sb.size - inter)
}

function similarityBasedMerge(
  perFileRaw: { fileName: string; questions: string[] }[]
): IRBFormDraftResult {
  const SIMILARITY_THRESHOLD = 0.55
  const groups: { key: string; canonical: string; variants: Set<string>; norm: string }[] = []
  let idx = 0

  for (const pf of perFileRaw) {
    for (const q of pf.questions) {
      const norm = normalizeQ(q)
      // 기존 그룹 중 유사한 것 찾기
      let bestGroup: (typeof groups)[0] | null = null
      let bestScore = SIMILARITY_THRESHOLD - 0.001
      for (const g of groups) {
        const score = jaccardSimilarity(norm, g.norm)
        if (score > bestScore) { bestScore = score; bestGroup = g }
      }
      if (bestGroup) {
        bestGroup.variants.add(q)
      } else {
        groups.push({ key: `q_${idx++}`, canonical: q, variants: new Set([q]), norm })
      }
    }
  }

  const questions: IRBFormQuestion[] = groups.map((g) => ({
    key: g.key,
    label: g.canonical,
    multiline: g.canonical.length > 15,
    originalVariants: Array.from(g.variants),
  }))

  // 각 파일 문항 → 그룹 key 매핑
  const fileSections = perFileRaw.map((pf) => ({
    fileName: pf.fileName,
    items: pf.questions.map((q) => {
      const norm = normalizeQ(q)
      let bestKey = `q_fallback_${q}`
      let bestScore = -1
      for (const g of groups) {
        const score = jaccardSimilarity(norm, g.norm)
        if (score > bestScore) { bestScore = score; bestKey = g.key }
      }
      return { question: q, answerKey: bestKey }
    }),
  }))

  return { questions, fileSections }
}

// ── 지정한 문항들의 답변 생성 (Phase 3 본체 · PATCH 보완에서 공용) ─────
async function generateItemAnswers(
  fileName: string,
  items: { question: string; answerKey: string }[],
  mergedQuestions: IRBFormQuestion[],
  userAnswers: IRBUserAnswers,
  naturalLanguageInput: string,
  projectContext = '',
): Promise<{ question: string; answer: string }[]> {
  const collected: { question: string; answer: string }[] = []

  // 사용자가 실제로 준 입력 전부 — AI 답변이 여기에 근거하는지 검증하는 기준
  const sourceText = [naturalLanguageInput, projectContext, ...Object.values(userAnswers)].join('\n')

  // 문항을 CHUNK_SIZE 단위로 나눠 처리
  for (let start = 0; start < items.length; start += CHUNK_SIZE) {
    const chunk = items.slice(start, start + CHUNK_SIZE)
    const prompt = buildMappingPrompt(fileName, chunk, mergedQuestions, userAnswers, naturalLanguageInput, projectContext)
    const raw = await generateText({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
    })
    const parsed = parseFileOutput(raw)

    // 파싱 결과를 원본 문항 텍스트 기준으로 매핑 (퍼지 매칭)
    for (const item of chunk) {
      const direct = userAnswers[item.answerKey]?.trim()
      // 1순위: LLM 출력에서 퍼지 매칭
      const hit = matchParsedToOriginal(parsed, item.question)
      let answer = hit?.answer
      // 입력에 없는 내용을 지어낸 답변은 막는다: 근거 인용과 숫자가 입력에 있어야 통과
      if (hit && !isMissing(hit.answer)) {
        const verdict = verifyAnswer(item.question, hit.answer, hit.evidence, sourceText)
        if (!verdict.ok) {
          console.warn(`[irb-form-draft] 근거 없는 답변 차단 (${verdict.reason}${verdict.detail ? `: ${verdict.detail}` : ''}):`, item.question)
          answer = undefined
        } else if (verdict.warning) {
          // 막지 않음 — 입력에서 나온 내용이지만 다른 칸의 내용일 수 있어 검토 때 확인
          console.info(`[irb-form-draft] 확인 권장 (${verdict.warning}, 답변은 유지):`, item.question)
        }
      }
      // 2순위: 직접 입력값이 있으면 안전망으로 사용 (LLM이 누락했거나 차단됐을 때)
      if (!answer && direct) answer = direct
      collected.push({ question: item.question, answer: answer ?? MISSING_MARKER })
    }
  }
  return collected
}

// ── LLM 중복통합 결과 타입 ─────────────────────────────────────
interface LLMMergeResult {
  mergedQuestions: Array<{
    key: string
    label: string
    multiline: boolean
    variants: string[]
  }>
  fileMappings: Array<{
    fileName: string
    items: Array<{ originalQuestion: string; mergedKey: string }>
  }>
}

// ── 메인 핸들러 ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '로그인이 필요합니다.' }, { status: 401 })
  }

  const contentType = req.headers.get('content-type') ?? ''

  // ══════════════════════════════════════════════════════════
  // Phase 1: 파일 → 문항 추출 + LLM 의미 기반 중복 통합
  // ══════════════════════════════════════════════════════════
  if (contentType.includes('multipart/form-data')) {
    let formData: FormData
    try { formData = await req.formData() }
    catch { return NextResponse.json({ error: 'BadRequest' }, { status: 400 }) }

    const files = formData.getAll('file').filter((f): f is File => f instanceof File)
    if (files.length === 0)
      return NextResponse.json({ error: 'BadRequest', message: '파일이 필요합니다.' }, { status: 400 })

    const SUPPORTED = ['pdf', 'docx', 'txt', 'hwp', 'hwpx']
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      if (!SUPPORTED.includes(ext))
        return NextResponse.json({ error: 'UnsupportedFormat', message: 'PDF, DOCX, TXT, HWP, HWPX만 지원합니다.' }, { status: 400 })
      if (f.size > MAX_FILE_SIZE)
        return NextResponse.json({ error: 'FileTooLarge', message: '파일당 최대 10MB입니다.' }, { status: 400 })
    }

    // 텍스트 추출
    const extracted: { name: string; text: string }[] = []
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      const buffer = Buffer.from(await f.arrayBuffer())
      if (ext === 'pdf') {
        if (isLuxiaProvider()) {
          // Luxia는 PDF native 미지원 — 스킵
          console.warn('[irb-form-draft] PDF skipped on Luxia provider:', f.name)
          continue
        }
        try {
          const { anthropic } = await import('@/lib/anthropic')
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 2048,
            messages: [{ role: 'user', content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } } as any,
              { type: 'text', text: '이 PDF 문서의 모든 텍스트를 그대로 추출해주세요. 양식 구조와 항목명을 최대한 보존하세요.' },
            ]}] as any,
          })
          const text = response.content[0]?.type === 'text' ? response.content[0].text : null
          if (text) extracted.push({ name: f.name, text })
        } catch (e) {
          console.error('[irb-form-draft] PDF extraction failed:', e)
        }
      } else {
        const text = await extractText(f.name, buffer)
        if (text) extracted.push({ name: f.name, text })
      }
    }

    if (extracted.length === 0)
      return NextResponse.json({ error: 'ParseError', message: '파일에서 텍스트를 읽을 수 없습니다.' }, { status: 422 })

    try {
      // Phase 1-A: 파일별 raw 문항 추출 (순차 처리)
      const perFileRaw: { fileName: string; questions: string[] }[] = []
      for (const f of extracted) {
        // 전체 텍스트를 청크로 나눠 모두 분석 (앞부분만 자르지 않음)
        const chunks = splitIntoChunks(f.text)
        console.log(`[irb-form-draft] ${f.name}: ${f.text.length} chars → ${chunks.length} chunk(s)`)

        const chunkQuestions: string[][] = new Array(chunks.length).fill(null).map(() => [])
        for (let s = 0; s < chunks.length; s += RAW_CONCURRENCY) {
          await Promise.all(
            chunks.slice(s, s + RAW_CONCURRENCY).map(async (chunk, k) => {
              const idx = s + k
              try {
                const raw = await generateText({
                  messages: [{ role: 'user', content: buildRawExtractionPrompt(f.name, chunk, idx + 1, chunks.length) }],
                  maxTokens: 4000,
                })
                const jsonMatch = raw.match(/\{[\s\S]*\}/)
                if (!jsonMatch) return
                const parsed = JSON.parse(jsonMatch[0]) as { items?: { question: string }[] }
                chunkQuestions[idx] = (parsed.items ?? []).map((i) => i.question).filter(Boolean)
              } catch (e) {
                // 한 구간 실패가 파일 전체를 막지 않도록 — 해당 구간만 건너뜀
                console.warn(`[irb-form-draft] chunk ${idx + 1}/${chunks.length} failed for ${f.name}:`, e)
              }
            })
          )
        }

        // 구간 순서대로 합치되, 겹치는 구간에서 생긴 동일 문항은 제거
        const seen = new Set<string>()
        const questions: string[] = []
        for (const q of chunkQuestions.flat()) {
          const k = q.replace(/\s+/g, '').toLowerCase()
          if (seen.has(k)) continue
          seen.add(k)
          questions.push(q)
        }
        perFileRaw.push({ fileName: f.name, questions })
      }

      const totalQuestions = perFileRaw.reduce((s, f) => s + f.questions.length, 0)
      console.log(`[irb-form-draft] Phase 1-A: extracted ${totalQuestions} raw questions from ${perFileRaw.length} files`)

      // Phase 1-B: 항상 LLM 의미 기반 중복 통합 (단일 파일 포함)
      let result: IRBFormDraftResult

      {
        // LLM 의미 기반 중복 통합
        const dedupeRaw = await generateText({
          messages: [{ role: 'user', content: buildDeduplicationPrompt(perFileRaw) }],
          maxTokens: 8000,
        })

        const jsonMatch = dedupeRaw.match(/\{[\s\S]*\}/)
        let mergeResult: LLMMergeResult | null = null
        if (jsonMatch) {
          try {
            mergeResult = JSON.parse(jsonMatch[0]) as LLMMergeResult
          } catch {
            console.warn('[irb-form-draft] dedup JSON parse failed, falling back to similarity-based merge')
          }
        }

        if (mergeResult?.mergedQuestions?.length && mergeResult?.fileMappings?.length) {
          // LLM 결과 활용
          const questions: IRBFormQuestion[] = mergeResult.mergedQuestions.map((q, i) => ({
            key: q.key || `q_${i}`,
            label: q.label,
            multiline: q.multiline ?? q.label.length > 15,
            originalVariants: q.variants ?? [q.label],
          }))

          const keySet = new Set(questions.map((q) => q.key))
          const fileSections = mergeResult.fileMappings.map((fm) => ({
            fileName: fm.fileName,
            items: fm.items
              .filter((item) => keySet.has(item.mergedKey))
              .map((item) => ({
                question: item.originalQuestion,
                answerKey: item.mergedKey,
              })),
          }))

          result = { questions, fileSections }
        } else {
          // LLM 실패 → 폴백: 유사도 기반 중복 통합
          console.warn('[irb-form-draft] LLM dedup failed, using similarity-based fallback')
          result = similarityBasedMerge(perFileRaw)
        }
      }

      console.log(`[irb-form-draft] Phase 1 complete: ${result.questions.length} merged questions, ${result.fileSections.length} file sections`)
      return NextResponse.json(result)
    } catch (e) {
      console.error('[irb-form-draft] Phase 1 error:', e)
      return NextResponse.json({ error: 'InternalServerError', message: '문항 추출에 실패했습니다.' }, { status: 500 })
    }
  }

  // ══════════════════════════════════════════════════════════
  // Phase 3: 사용자 답변 → 파일별 지능형 매핑 및 초안 생성
  // ══════════════════════════════════════════════════════════
  if (contentType.includes('application/json')) {
    let body: {
      projectId?: string
      fileSections: IRBFormDraftResult['fileSections']
      mergedQuestions: IRBFormDraftResult['questions']
      userAnswers: IRBUserAnswers
      naturalLanguageInput: string
    }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: 'BadRequest' }, { status: 400 }) }

    const { fileSections, mergedQuestions, userAnswers, naturalLanguageInput } = body

    if (!fileSections?.length) {
      return NextResponse.json({ error: 'BadRequest', message: 'fileSections가 필요합니다.' }, { status: 400 })
    }
    if (!mergedQuestions?.length) {
      return NextResponse.json({ error: 'BadRequest', message: 'mergedQuestions가 필요합니다.' }, { status: 400 })
    }
    // 문서 요약본 + 모듈 카드 내용 → 모든 문항 생성 프롬프트 최상단에 주입
    const projectContext = await loadProjectContext(body.projectId, session.user.id)

    // 개별 답변, 자연어 입력, 프로젝트 컨텍스트(요약본/모듈 내용) 중 하나는 있어야 함
    const hasAnyInput =
      naturalLanguageInput?.trim() ||
      projectContext ||
      Object.values(userAnswers ?? {}).some((v) => v?.trim())
    if (!hasAnyInput) {
      return NextResponse.json({
        error: 'BadRequest',
        message: '연구 설명 또는 개별 입력 중 하나 이상을 입력해주세요.',
      }, { status: 400 })
    }

    try {
      const perFileSections: IRBFormDraftOutput['sections'] = []

      for (const fileSection of fileSections) {
        const collectedItems = await generateItemAnswers(
          fileSection.fileName,
          fileSection.items,
          mergedQuestions,
          userAnswers ?? {},
          naturalLanguageInput ?? '',
          projectContext,
        )

        // 원본 문항 순서 보장
        const collectedMap = new Map(collectedItems.map((i) => [i.question, i.answer]))
        perFileSections.push({
          fileName: fileSection.fileName,
          items: fileSection.items.map((i) => ({
            question: i.question,
            answer: collectedMap.get(i.question) ?? MISSING_MARKER,
          })),
        })
      }

      const output: IRBFormDraftOutput = { sections: perFileSections, rawText: buildRawText(perFileSections) }

      // Phase 3 완료 → DB 저장 (projectId가 있을 때)
      //  - formDraftJson   : 문항 구조 (덮어쓰지 않고 유지 → 워크스페이스로 돌아와도 재업로드 불필요)
      //  - draftOutputJson : 생성된 초안
      //  - userInputJson   : 사용자 입력 원본 (보완/재생성 때 AI에 다시 전달)
      const projectId = body.projectId as string | undefined
      if (projectId) {
        try {
          await prisma.project.updateMany({
            where: { id: projectId, userId: session.user.id },
            data: {
              formDraftJson: JSON.stringify({ questions: mergedQuestions, fileSections } satisfies IRBFormDraftResult),
              draftOutputJson: JSON.stringify(output),
              userInputJson: JSON.stringify({
                userAnswers: userAnswers ?? {},
                naturalLanguageInput: naturalLanguageInput ?? '',
              } satisfies IRBUserInput),
            },
          })
        } catch (e) {
          // DB 저장 실패는 응답을 막지 않음 — 로그만
          console.warn('[irb-form-draft] DB save failed:', e)
        }
      }

      return NextResponse.json(output satisfies IRBFormDraftOutput)
    } catch (e) {
      console.error('[irb-form-draft] Phase 3 error:', e)
      return NextResponse.json({ error: 'InternalServerError', message: '초안 생성에 실패했습니다.' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'BadRequest' }, { status: 400 })
}

// ══════════════════════════════════════════════════════════
// PATCH: 검토 화면 보충 입력 → 저장된 입력과 병합 → 누락 문항만 AI 재생성
// Body: { projectId, supplements: { answerKey, supplement }[] }
//  1) 보충 입력을 userAnswers 에 병합하고 userInputJson 에 저장 (이후 재생성의 근거가 됨)
//  2) 같은 answerKey 를 쓰는 **모든 파일**의 누락 문항만 대상으로 AI 호출
//     (자연어 입력 + 병합된 전체 입력이 컨텍스트로 다시 전달됨)
//  3) 대상 문항만 교체 — 이미 채워졌거나 사용자가 직접 수정한 답변은 코드 레벨에서 보존
// ══════════════════════════════════════════════════════════
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { projectId?: string; supplements?: Array<{ answerKey: string; supplement: string }> }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'BadRequest' }, { status: 400 }) }

  const supplements = (body.supplements ?? []).filter((s) => s?.answerKey && s.supplement?.trim())
  if (!body.projectId || supplements.length === 0) {
    return NextResponse.json({ error: 'BadRequest', message: 'projectId와 supplements가 필요합니다.' }, { status: 400 })
  }

  const project = await prisma.project.findFirst({
    where: { id: body.projectId, userId: session.user.id },
    select: {
      id: true,
      formDraftJson: true,
      draftOutputJson: true,
      userInputJson: true,
      sourceSummary: true,
      modules: {
        select: { content: true, module: { select: { name: true } } },
        orderBy: { order: 'asc' },
      },
    },
  })
  if (!project) {
    return NextResponse.json({ error: 'NotFound', message: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }

  const stored = parseStoredDraft(project)
  if (!stored.output || !stored.effectiveStructure) {
    return NextResponse.json({ error: 'BadRequest', message: '생성된 초안이 없습니다.' }, { status: 400 })
  }

  try {
    const structure = stored.effectiveStructure
    const userAnswers = mergeSupplements(stored.userInput.userAnswers, supplements)
    const naturalLanguageInput = stored.userInput.naturalLanguageInput

    const projectContext = buildProjectContext(project)

    const targets = findPatchTargets(stored.output, structure, supplements.map((s) => s.answerKey))

    const updates: Array<{ fileName: string; question: string; answer: string }> = []
    for (const t of targets) {
      const answers = await generateItemAnswers(t.fileName, t.items, structure.questions, userAnswers, naturalLanguageInput, projectContext)
      for (const a of answers) updates.push({ fileName: t.fileName, question: a.question, answer: a.answer })
    }

    const result: IRBFormDraftOutput = applyAnswers(stored.output, updates)

    await prisma.project.update({
      where: { id: project.id },
      data: {
        draftOutputJson: JSON.stringify(result),
        userInputJson: JSON.stringify({ userAnswers, naturalLanguageInput } satisfies IRBUserInput),
      },
    })

    return NextResponse.json(result satisfies IRBFormDraftOutput)
  } catch (e) {
    console.error('[irb-form-draft PATCH] error:', e)
    return NextResponse.json({ error: 'InternalServerError', message: '보완 생성에 실패했습니다.' }, { status: 500 })
  }
}
