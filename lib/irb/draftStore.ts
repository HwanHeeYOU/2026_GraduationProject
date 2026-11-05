/**
 * 초안 저장/병합 순수 함수 모음 (서버·클라이언트 공용, DB/AI 의존 없음)
 *
 * Project 의 3개 컬럼을 분리해서 다룬다.
 *  - formDraftJson   : 문항 구조 (IRBFormDraftResult)   ← 초안 생성 후에도 유지
 *  - draftOutputJson : 생성된 초안 (IRBFormDraftOutput)
 *  - userInputJson   : 사용자 입력 원본 (IRBUserInput)
 * 예전 프로젝트는 formDraftJson 에 Output 이 덮어써져 있으므로 그 경우도 읽어 준다(legacy).
 */
import type {
  IRBFormDraftOutput,
  IRBFormDraftResult,
  IRBFormQuestion,
  IRBUserAnswers,
  IRBUserInput,
} from './types'

export const MISSING_MARKER = '[작성 필요: 추가 정보 입력 요망]'
export const MISSING_PREFIX = '[작성 필요'

export const isMissing = (answer: string | undefined | null): boolean =>
  !!answer && answer.includes(MISSING_PREFIX)

const normQ = (q: string) => q.trim().replace(/\s+/g, ' ').toLowerCase()
const itemKey = (fileName: string, question: string) => `${fileName}|||${normQ(question)}`

// ── 파싱 ────────────────────────────────────────────────────
function safeParse(json: string | null | undefined): unknown {
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isStructure(v: any): v is IRBFormDraftResult {
  return (
    Array.isArray(v?.questions) && v.questions.length > 0 &&
    Array.isArray(v?.fileSections) && v.fileSections.length > 0
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isOutput(v: any): v is IRBFormDraftOutput {
  return Array.isArray(v?.sections)
}

/** 구조가 저장돼 있지 않은 예전 프로젝트용: 출력의 문항으로부터 임시 구조를 만든다. (같은 문항 = 같은 키) */
export function deriveStructure(output: IRBFormDraftOutput): IRBFormDraftResult {
  const keyOf = new Map<string, string>()
  const questions: IRBFormQuestion[] = []
  const fileSections = output.sections.map((sec) => ({
    fileName: sec.fileName,
    items: sec.items.map((item) => {
      const n = normQ(item.question)
      let key = keyOf.get(n)
      if (!key) {
        key = `k_${keyOf.size}`
        keyOf.set(n, key)
        questions.push({ key, label: item.question.trim(), multiline: item.question.length > 15 })
      }
      return { question: item.question, answerKey: key }
    }),
  }))
  return { questions, fileSections }
}

export interface StoredDraft {
  /** 실제로 저장돼 있는 문항 구조 (없으면 null → 워크스페이스는 업로드부터 시작) */
  structure: IRBFormDraftResult | null
  /** structure 가 없어도 항상 쓸 수 있는 구조 (없으면 출력에서 유도) */
  effectiveStructure: IRBFormDraftResult | null
  output: IRBFormDraftOutput | null
  userInput: IRBUserInput
}

export function parseStoredDraft(cols: {
  formDraftJson?: string | null
  draftOutputJson?: string | null
  userInputJson?: string | null
}): StoredDraft {
  const fd = safeParse(cols.formDraftJson)
  const od = safeParse(cols.draftOutputJson)
  const ud = safeParse(cols.userInputJson) as Partial<IRBUserInput> | null

  const structure = isStructure(fd) ? fd : null
  // 새 컬럼 우선, 없으면 legacy(formDraftJson 에 Output 이 덮어써진 경우)
  const output = isOutput(od) ? od : isOutput(fd) ? fd : null

  return {
    structure,
    effectiveStructure: structure ?? (output ? deriveStructure(output) : null),
    output,
    userInput: {
      userAnswers: (ud?.userAnswers && typeof ud.userAnswers === 'object' ? ud.userAnswers : {}) as IRBUserAnswers,
      naturalLanguageInput: typeof ud?.naturalLanguageInput === 'string' ? ud.naturalLanguageInput : '',
    },
  }
}

// ── 출력 가공 ───────────────────────────────────────────────
export function buildRawText(sections: IRBFormDraftOutput['sections']): string {
  return sections
    .map((s) => {
      const items = s.items.map((i) => `[문항] ${i.question}\n[답변] ${i.answer}`).join('\n\n')
      return `[파일: ${s.fileName}]\n${items}`
    })
    .join('\n\n' + '─'.repeat(40) + '\n\n')
}

/** 지정한 (파일, 문항) 의 답변만 교체한다. 나머지는 절대 건드리지 않는다. */
export function applyAnswers(
  output: IRBFormDraftOutput,
  updates: Array<{ fileName: string; question: string; answer: string }>,
): IRBFormDraftOutput {
  const map = new Map(updates.map((u) => [itemKey(u.fileName, u.question), u.answer]))
  const sections = output.sections.map((sec) => ({
    fileName: sec.fileName,
    items: sec.items.map((item) => {
      const next = map.get(itemKey(sec.fileName, item.question))
      return next === undefined ? item : { question: item.question, answer: next }
    }),
  }))
  return { sections, rawText: buildRawText(sections) }
}

function answerKeyLookup(structure: IRBFormDraftResult): Map<string, string> {
  const m = new Map<string, string>()
  for (const fs of structure.fileSections) {
    for (const it of fs.items) m.set(itemKey(fs.fileName, it.question), it.answerKey)
  }
  return m
}

export interface MissingGroup {
  answerKey: string
  label: string
  items: Array<{ fileName: string; question: string }>
}

/** 누락 항목을 answerKey 로 묶는다. 같은 정보를 요구하는 여러 문서의 문항 = 입력란 1개. */
export function groupMissing(output: IRBFormDraftOutput, structure: IRBFormDraftResult): MissingGroup[] {
  const lookup = answerKeyLookup(structure)
  const labelOf = new Map(structure.questions.map((q) => [q.key, q.label]))
  const groups = new Map<string, MissingGroup>()
  for (const sec of output.sections) {
    for (const item of sec.items) {
      if (!isMissing(item.answer)) continue
      // 구조에 없는 문항(매핑 실패)은 문항 텍스트 자체를 키로 쓴다
      const key = lookup.get(itemKey(sec.fileName, item.question)) ?? `q::${normQ(item.question)}`
      let g = groups.get(key)
      if (!g) {
        g = { answerKey: key, label: labelOf.get(key) ?? item.question.trim(), items: [] }
        groups.set(key, g)
      }
      g.items.push({ fileName: sec.fileName, question: item.question })
    }
  }
  return Array.from(groups.values())
}

/** 보충 입력을 userAnswers 에 병합 (이미 값이 있으면 이어 붙임) */
export function mergeSupplements(
  userAnswers: IRBUserAnswers,
  supplements: Array<{ answerKey: string; supplement: string }>,
): IRBUserAnswers {
  const next: IRBUserAnswers = { ...userAnswers }
  for (const s of supplements) {
    const add = s.supplement.trim()
    if (!add) continue
    const prev = next[s.answerKey]?.trim()
    next[s.answerKey] = prev ? `${prev}\n${add}` : add
  }
  return next
}

/** 보완 대상: 보충 입력이 들어온 answerKey 를 쓰는 **모든 파일**의 누락 문항 */
export function findPatchTargets(
  output: IRBFormDraftOutput,
  structure: IRBFormDraftResult,
  answerKeys: string[],
): Array<{ fileName: string; items: Array<{ question: string; answerKey: string }> }> {
  const keys = new Set(answerKeys)
  const lookup = answerKeyLookup(structure)
  const out: Array<{ fileName: string; items: Array<{ question: string; answerKey: string }> }> = []
  for (const sec of output.sections) {
    const items = sec.items
      .filter((i) => isMissing(i.answer))
      .map((i) => ({
        question: i.question,
        answerKey: lookup.get(itemKey(sec.fileName, i.question)) ?? `q::${normQ(i.question)}`,
      }))
      .filter((i) => keys.has(i.answerKey))
    if (items.length > 0) out.push({ fileName: sec.fileName, items })
  }
  return out
}
