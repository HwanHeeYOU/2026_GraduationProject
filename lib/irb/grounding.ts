/**
 * AI 가 만든 답변이 사용자가 실제로 준 입력에 근거하는지 확인한다 (지어낸 내용 차단).
 *
 * IRB 서류에서 입력에 없는 금액·기간·인원·절차가 채워지면 위험하므로, 프롬프트 지시에만 의존하지 않고
 * 코드에서 두 가지를 검증한다.
 *  1) 근거 인용: AI 가 답변마다 입력 원문을 글자 그대로 인용하게 하고, 그 인용이 실제 입력에 있는지 확인
 *  2) 숫자: 답변에 나온 숫자(금액·기간·인원 …)가 모두 입력에 있는지 확인
 * 어느 하나라도 통과하지 못하면 호출부가 답변을 [작성 필요] 로 바꾼다.
 */

/** 비교용 정규화: 공백·문장부호·기호 제거, 소문자 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s\u00a0.,·:;!?"'“”‘’()[\]{}<>「」『』~\-–—_/\\|*※•○●■□]/g, '')
}

function ngrams(s: string, n: number): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i <= s.length - n; i++) set.add(s.slice(i, i + n))
  return set
}

/** 인용이 입력에 얼마나 들어 있는가 (0~1). 글자 그대로 들어 있으면 1, 아니면 3-글자 조각 포함 비율. */
export function quoteCoverage(quote: string, sourceNorm: string): number {
  const q = normalizeForMatch(quote)
  if (q.length < 2) return 0
  if (sourceNorm.includes(q)) return 1
  if (q.length < 4) return 0
  const grams = ngrams(q, 3)
  if (grams.size === 0) return 0
  let hit = 0
  grams.forEach((g) => { if (sourceNorm.includes(g)) hit++ })
  return hit / grams.size
}

/** 번호 매기기("1.", "2)", "3단계", "1단계:") 는 숫자로 치지 않는다. 줄 맨 앞과 " / " 구분 뒤의 번호 모두. */
function stripEnumerators(s: string): string {
  return s
    .replace(/(^|\n|\/)\s*\d{1,2}\s*[.)](?!\d)\s*/g, '$1')
    .replace(/\d{1,2}\s*단계/g, '')
}

/** 문자열 속 숫자들 (천 단위 쉼표 제거). "10,000" → "10000", "2.0" → "2.0" */
export function numbersIn(s: string): string[] {
  return (stripEnumerators(s).match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''))
}

export interface GroundingVerdict {
  ok: boolean
  reason?: 'no-evidence' | 'evidence-not-in-input' | 'number-not-in-input' | 'answer-not-in-input'
  detail?: string
  /**
   * 막지는 않지만 사람이 확인하면 좋은 경우.
   * off-topic: 답이 나온 입력 문장에 문항의 주제 단어가 없음 (다른 칸의 내용을 옮겨 왔을 수 있음)
   */
  warning?: 'off-topic'
}

/**
 * 문항 단어 중 주제를 가리키지 않는 말. 이 말이 겹친다고 같은 주제로 보지 않는다.
 * ("자료 보관 방법" 의 "방법", "제공기관" 의 "기관" 등)
 */
const GENERIC_BIGRAMS = new Set([
  '연구', '여부', '사항', '내용', '방법', '기준', '계획', '정보', '항목', '설명', '관련', '경우',
  '기관', '대한', '위한', '해당', '작성', '기재', '또는', '혹은', '입력', '여러', '건입',
])

/**
 * 문항이 이 말로 끝나면 "이름표 칸"으로 본다. 입력에 라벨 없이 쓰는 게 보통인 칸들이다.
 *  - 신상: "성명", "연구책임자 소속", "공동연구자 직위", "이메일 주소" …
 *  - 이름: "연구제목"(첫 줄에 제목만 쓰거나 "본 연구는 …" 으로 씀), "과제명", "연구책임자명", "소속기관명", "주소"
 * "설명" 처럼 "명"으로 끝나는 일반 문항이 걸리지 않도록 "명" 단독은 넣지 않는다.
 */
const IDENTITY_FIELD =
  /(?:성명|이름|소속|직위|직급|직책|전공|전공분야|학과|연락처|전화|전화번호|휴대전화|이메일|이메일주소|메일|제목|과제명|연구명|책임자명|연구자명|기관명|주소)$/

/** 입력 글을 문장 단위로 (정규화된 문장 목록) */
function sourceSentences(source: string): string[] {
  return source.split(/[.。!?\n]/).map(normalizeForMatch).filter((s) => s.length >= 2)
}

/** text 와 가장 많이 겹치는 입력 문장들 (겹침 0.5 미만이면 위치를 특정할 수 없다고 보고 빈 목록) */
function locate(text: string, sentences: string[]): string[] {
  let best = 0
  const hits: string[] = []
  for (const s of sentences) {
    const c = bigramCoverage(text, s)
    if (c > best + 1e-9) { best = c; hits.length = 0; hits.push(s) }
    else if (Math.abs(c - best) < 1e-9) hits.push(s)
  }
  return best >= 0.5 ? hits : []
}

/** 문항의 주제 조각: 문항 단어의 2-글자 조각 중 일반적인 말이 아닌 것 */
function topicBigrams(question: string): Set<string> {
  const q = normalizeForMatch(question.replace(/여러\s*건\s*입력/g, ' '))
  const out = new Set<string>()
  for (let i = 0; i < q.length - 1; i++) {
    const g = q.slice(i, i + 2)
    if (!GENERIC_BIGRAMS.has(g) && !/\d{2}/.test(g)) out.add(g)
  }
  return out
}

/**
 * 답변이 이 문항의 주제에 대한 입력 문장에서 나왔는가.
 * 답변·근거가 나온 입력 문장에 문항의 주제 조각이 하나도 없으면 다른 주제의 문장을 옮겨 온 것으로 본다.
 *   예) 문항 "관찰 항목", 답 "과제 수행 중 일시적인 피로감" ← 입력 "연구참여로 인한 위험은 … 피로감 정도입니다"
 */
export function isOnTopic(question: string, answer: string, evidence: string, source: string): boolean {
  // 신상 칸(성명·소속·직위·연락처 …)은 입력이 "연구책임자는 김민수이고 … 조교수"처럼 라벨 없이 쓰는 게 보통이라 검사하지 않는다.
  // (근거 인용·숫자·문장 검사는 그대로 적용된다)
  if (IDENTITY_FIELD.test(normalizeForMatch(question.replace(/[(（][^)）]*[)）]/g, '')))) return true
  const topic = topicBigrams(question)
  if (topic.size === 0) return true
  const sentences = sourceSentences(source)
  const pieces = [...splitClauses(answer), ...evidence.split(/\s*\|\s*|\n/)].map((s) => s.trim()).filter(Boolean)
  const located = new Set<string>()
  for (const p of pieces) for (const s of locate(p, sentences)) located.add(s)
  if (located.size === 0) return true // 위치를 못 찾으면 이 검사로는 판단하지 않는다 (다른 검사가 막는다)
  for (const s of located) {
    for (const g of topic) if (s.includes(g)) return true
  }
  return false
}

/** 근거 인용이 이 비율 이상 입력에 들어 있어야 통과 */
export const EVIDENCE_MIN_COVERAGE = 0.85

/**
 * 답변의 문장(구절) 하나하나가 이 비율 이상 입력에 들어 있어야 통과.
 * 조사·어미가 바뀌는 정도의 바꿔 쓰기는 통과하고, 새 내용을 덧붙인 문장은 걸러지는 값.
 */
export const CLAUSE_MIN_COVERAGE = 0.7

/** 이 길이(정규화 후) 미만의 짧은 구절은 검사하지 않는다 ("없음", "교수" 등). 숫자는 따로 검사한다. */
const CLAUSE_MIN_LEN = 4

/** 답변을 문장·구절 단위로 나눈다: 문장 끝, 줄바꿈, 쉼표, " / " */
export function splitClauses(answer: string): string[] {
  return answer
    .split(/[.。!?\n]|,\s|\s\/\s/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 2-글자 조각 기준으로 text 가 입력에 들어 있는 비율 (조사·어미 차이에 덜 민감) */
export function bigramCoverage(text: string, sourceNorm: string): number {
  const t = normalizeForMatch(text)
  if (t.length < 2) return 1
  if (sourceNorm.includes(t)) return 1
  const grams = ngrams(t, 2)
  let hit = 0
  grams.forEach((g) => { if (sourceNorm.includes(g)) hit++ })
  return grams.size === 0 ? 1 : hit / grams.size
}

/**
 * @param answer   AI 가 쓴 답변
 * @param evidence AI 가 인용한 근거 원문 (여러 개면 ' | ' 로 구분). 없으면 빈 문자열
 * @param source   사용자가 준 모든 입력을 이은 글 (자연어 설명 + 프로젝트 컨텍스트 + 개별 입력)
 */
export function verifyGrounded(answer: string, evidence: string, source: string): GroundingVerdict {
  const sourceNorm = normalizeForMatch(source)

  // 숫자: 답변의 숫자는 전부 입력에 있어야 한다
  const sourceNums = new Set(numbersIn(source))
  for (const n of numbersIn(answer)) {
    if (!sourceNums.has(n)) return { ok: false, reason: 'number-not-in-input', detail: n }
  }

  // 답변 전체가 입력에 그대로 들어 있으면 (개별 입력값을 그대로 쓴 경우 등) 근거로 충분
  const a = normalizeForMatch(answer)
  if (a.length >= 2 && sourceNorm.includes(a)) return { ok: true }

  // 답변의 구절마다 입력에 있어야 한다. 근거는 입력에서 인용하고 답변은 새로 지어내는 경우를 막는다.
  for (const clause of splitClauses(answer)) {
    if (normalizeForMatch(clause).length < CLAUSE_MIN_LEN) continue
    if (bigramCoverage(clause, sourceNorm) < CLAUSE_MIN_COVERAGE) {
      return { ok: false, reason: 'answer-not-in-input', detail: clause.slice(0, 40) }
    }
  }

  const quotes = evidence
    .split(/\s*\|\s*|\n/)
    .map((q) => q.trim())
    .filter((q) => q && !/^(?:없음|해당\s*없음|n\/a|-)$/i.test(q))
  if (quotes.length === 0) return { ok: false, reason: 'no-evidence' }

  for (const q of quotes) {
    if (quoteCoverage(q, sourceNorm) < EVIDENCE_MIN_COVERAGE) {
      return { ok: false, reason: 'evidence-not-in-input', detail: q.slice(0, 40) }
    }
  }
  return { ok: true }
}

/**
 * verifyGrounded + 주제 검사.
 * 주제 검사는 막지 않고 warning 만 단다. 입력을 양식 용어 없이 쓰면(예: "승인 후 6개월간 진행" → 연구기간)
 * 정상 답도 걸려서, 막으면 빈칸이 지나치게 늘어난다. 내용은 입력에서 나온 것이므로 칸이 맞는지는 검토 화면에서 확인한다.
 */
export function verifyAnswer(question: string, answer: string, evidence: string, source: string): GroundingVerdict {
  const v = verifyGrounded(answer, evidence, source)
  if (!v.ok) return v
  if (!isOnTopic(question, answer, evidence, source)) return { ...v, warning: 'off-topic' }
  return v
}
