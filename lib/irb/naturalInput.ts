/**
 * 초안 생성 프롬프트에 넣을 "자연어 연구 설명"을 길이 한도에 맞춘다.
 *
 * 예전에는 앞 4000자만 남기고 뒤를 잘랐다. 사용자가 계획서 내용을 길게 붙여넣고 그 뒤에
 * 연구자 정보(연락처·학력·경력 …)를 적으면 뒷부분이 통째로 사라져 "정보를 입력하지 않았다"는
 * 결과가 나왔다. 이제는 한도 안이면 전부 보내고, 넘으면 이번 문항들과 관련 있는 문단부터 남긴다.
 */

/** 문항 청크 하나에 실어 보낼 자연어 입력의 최대 글자 수 */
export const NATURAL_INPUT_MAX_CHARS = 12000

/** 문단 하나의 최대 길이 (긴 줄은 이 길이로 쪼개 점수를 매긴다) */
const SEGMENT_MAX_CHARS = 600

export const OMISSION_MARK = '…(관련 없는 부분 생략)…'

/** 문항 텍스트에서 비교용 단어(2자 이상 한글·영문·숫자)를 뽑는다. "(열1 / 열2) - 여러 건 입력" 같은 군더더기는 제외. */
function keywordsOf(questions: string[]): string[] {
  const words = new Set<string>()
  for (const q of questions) {
    const cleaned = q.replace(/여러\s*건\s*입력/g, ' ').replace(/[()（）\[\]/\-–:·,]/g, ' ')
    for (const w of cleaned.split(/\s+/)) {
      const t = w.trim().toLowerCase()
      if (t.length >= 2) words.add(t)
    }
  }
  return Array.from(words)
}

/** 줄 단위로 나누되 짧은 줄은 이어 붙여 SEGMENT_MAX_CHARS 이하의 문단 목록을 만든다. */
function toSegments(text: string): string[] {
  const segments: string[] = []
  let cur = ''
  const flush = () => { if (cur) { segments.push(cur); cur = '' } }
  for (const line of text.split('\n')) {
    if (line.length > SEGMENT_MAX_CHARS) {
      flush()
      for (let i = 0; i < line.length; i += SEGMENT_MAX_CHARS) segments.push(line.slice(i, i + SEGMENT_MAX_CHARS))
      continue
    }
    if (cur && cur.length + line.length + 1 > SEGMENT_MAX_CHARS) flush()
    cur = cur ? `${cur}\n${line}` : line
  }
  flush()
  return segments
}

export function fitNaturalInput(
  input: string,
  questions: string[],
  maxChars = NATURAL_INPUT_MAX_CHARS,
): string {
  const text = (input ?? '').trim()
  if (text.length <= maxChars) return text

  const keys = keywordsOf(questions)
  const segments = toSegments(text)
  const scored = segments.map((s, index) => {
    const low = s.toLowerCase()
    return { index, s, score: keys.reduce((n, k) => (low.includes(k) ? n + 1 : n), 0) }
  })

  // 점수가 높은 문단부터, 같으면 앞쪽부터 담는다. 한도를 넘는 문단은 건너뛰고 더 짧은 문단을 계속 찾는다.
  const picked = new Set<number>()
  let used = 0
  for (const seg of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (used + seg.s.length + 1 > maxChars) continue
    picked.add(seg.index)
    used += seg.s.length + 1
  }

  // 원래 순서로 되돌리고, 건너뛴 구간에는 생략 표시를 한 번만 넣는다.
  const out: string[] = []
  let omitted = false
  for (const seg of scored) {
    if (picked.has(seg.index)) {
      out.push(seg.s)
      omitted = false
    } else if (!omitted) {
      out.push(OMISSION_MARK)
      omitted = true
    }
  }
  return out.join('\n')
}
