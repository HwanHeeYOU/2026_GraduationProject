/**
 * 업로드한 기관 양식(.hwpx)에 AI 초안 답변을 채워 넣는다.
 *
 * HWPX = ZIP( Contents/section*.xml, header.xml, ... ).
 * 본문은 <hp:p>(문단) 안의 <hp:run><hp:t>텍스트</hp:t></hp:run> 구조이고,
 * 표는 <hp:tbl><hp:tr><hp:tc><hp:subList><hp:p>… 로 중첩된다.
 *
 * 전략
 *  1) 모든 문단의 텍스트를 문항(question)과 유사도 매칭한다.
 *  2) 문항이 표 셀 안에 있으면 → 오른쪽 셀(없거나 문항 셀이면 아래 셀)에 답변을 넣는다.
 *  3) 표 밖의 문단이면 → "라벨:" 형태는 같은 줄 뒤에, 아니면 다음 문단으로 삽입한다.
 *  4) 위치를 못 찾은 문항은 문서 맨 끝에 모아서 붙여 답변이 유실되지 않게 한다.
 *  원본의 서식(charPr/paraPr)·표 구조는 그대로 두고 텍스트만 건드린다.
 */
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

export interface HwpxFillItem {
  question: string
  answer: string
}

export interface HwpxFillResult {
  buffer: Buffer
  /** 양식에 실제로 채워 넣은 문항 수 */
  filled: number
  /** 아직 "작성 필요"라서 비워 둔 문항 */
  skippedMissing: string[]
  /** 양식에서 위치를 못 찾아 문서 끝에 모아 붙인 문항 */
  unmatched: string[]
}

const MISSING_PREFIX = '[작성 필요'
const MATCH_THRESHOLD = 0.6
const SECTION_RE = /^Contents\/section\d+\.xml$/i
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'

// ── DOM 유틸 ──────────────────────────────────────────────────
function lname(n: Node): string {
  const name = n.nodeName
  const i = name.indexOf(':')
  return i >= 0 ? name.slice(i + 1) : name
}

function childEls(el: Node, name?: string): Element[] {
  const out: Element[] = []
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && (!name || lname(c) === name)) out.push(c as Element)
  }
  return out
}

/** 문서 순서대로 모든 하위 요소 중 이름이 일치하는 것 */
function descendants(root: Node, name: string): Element[] {
  const out: Element[] = []
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue
      if (lname(c) === name) out.push(c as Element)
      walk(c)
    }
  }
  walk(root)
  return out
}

function closest(el: Node, name: string): Element | null {
  for (let n = el.parentNode; n; n = n.parentNode) {
    if (n.nodeType === 1 && lname(n) === name) return n as Element
  }
  return null
}

/** 문단 자신의 <t> 요소들 (중첩 표/글상자 안의 것은 제외) */
function ownTs(p: Element): Element[] {
  const out: Element[] = []
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue
      const nm = lname(c)
      if (nm === 'tbl' || nm === 'subList') continue
      if (nm === 't') out.push(c as Element)
      else walk(c)
    }
  }
  walk(p)
  return out
}

function tText(t: Element): string {
  let s = ''
  for (let c = t.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3 || c.nodeType === 4) s += (c as CharacterData).data
    else if (c.nodeType === 1 && (lname(c) === 'tab' || lname(c) === 'fwSpace')) s += ' '
  }
  return s
}

function setTText(doc: Document, t: Element, text: string) {
  while (t.firstChild) t.removeChild(t.firstChild)
  if (text) t.appendChild(doc.createTextNode(text))
}

function ownText(p: Element): string {
  return ownTs(p).map(tText).join('')
}

/** 레이아웃 캐시. 텍스트를 바꾸면 한글이 열 때 다시 계산하도록 제거한다. */
function dropLineSegs(p: Element) {
  for (const c of childEls(p, 'linesegarray')) p.removeChild(c)
}

function qualified(like: Element, name: string): string {
  return like.prefix ? `${like.prefix}:${name}` : name
}

function makeEl(doc: Document, like: Element, name: string): Element {
  return like.namespaceURI
    ? doc.createElementNS(like.namespaceURI, qualified(like, name))
    : doc.createElement(name)
}

function setParaText(doc: Document, p: Element, text: string) {
  const ts = ownTs(p)
  if (ts.length > 0) {
    setTText(doc, ts[0], text)
    for (let i = 1; i < ts.length; i++) setTText(doc, ts[i], '')
  } else {
    let run = childEls(p, 'run')[0]
    if (!run) {
      run = makeEl(doc, p, 'run')
      run.setAttribute('charPrIDRef', '0')
      p.appendChild(run)
    }
    const t = makeEl(doc, p, 't')
    setTText(doc, t, text)
    run.appendChild(t)
  }
  dropLineSegs(p)
}

function appendParaText(doc: Document, p: Element, text: string) {
  const ts = ownTs(p)
  if (ts.length === 0) return setParaText(doc, p, text)
  const last = ts[ts.length - 1]
  setTText(doc, last, tText(last) + ' ' + text)
  dropLineSegs(p)
}

/** refP와 같은 문단/글자 서식을 가진 새 문단을 refP 바로 뒤에 넣는다. */
function insertParaAfter(doc: Document, refP: Element, text: string): Element {
  const p = makeEl(doc, refP, 'p')
  for (let i = 0; i < refP.attributes.length; i++) {
    const a = refP.attributes[i]
    p.setAttribute(a.name, a.value)
  }
  const refRun = childEls(refP, 'run').find((r) => ownTsOfRun(r)) ?? childEls(refP, 'run')[0]
  const run = makeEl(doc, refP, 'run')
  run.setAttribute('charPrIDRef', refRun?.getAttribute('charPrIDRef') ?? '0')
  const t = makeEl(doc, refP, 't')
  setTText(doc, t, text)
  run.appendChild(t)
  p.appendChild(run)
  refP.parentNode!.insertBefore(p, refP.nextSibling)
  return p
}

function ownTsOfRun(run: Element): boolean {
  return childEls(run, 't').length > 0
}

// ── 문자열 매칭 ───────────────────────────────────────────────
function norm(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/^\s*[※*•·○●■□▶▷\-–]+\s*/, '')
    .replace(/^\s*[(\[]?\s*(?:\d{1,2}|[가-하]|[a-z])\s*[.)\]]\s*/, '')
    .replace(/[\s:：;,.\-_()[\]{}<>「」『』"'“”‘’·•※*?!/\\]/g, '')
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  if (s.length === 1) m.set(s, 1)
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length >= 2 && long.includes(short)) {
    const ratio = short.length / long.length
    if (ratio >= 0.5) return 0.7 + 0.3 * ratio
  }
  const ga = bigrams(a)
  const gb = bigrams(b)
  let overlap = 0
  let total = 0
  ga.forEach((v, k) => {
    total += v
    overlap += Math.min(v, gb.get(k) ?? 0)
  })
  gb.forEach((v) => (total += v))
  return total === 0 ? 0 : (2 * overlap) / total
}

// ── 표 셀 탐색 ────────────────────────────────────────────────
function colAddr(tc: Element): number | null {
  const addr = childEls(tc, 'cellAddr')[0]
  const v = addr?.getAttribute('colAddr')
  return v == null ? null : Number(v)
}

function nextCellInRow(tc: Element): Element | null {
  for (let n = tc.nextSibling; n; n = n.nextSibling) {
    if (n.nodeType === 1 && lname(n) === 'tc') return n as Element
  }
  return null
}

function cellBelow(tc: Element): Element | null {
  const tr = tc.parentNode as Element
  const cells = childEls(tr, 'tc')
  const idx = cells.indexOf(tc)
  const col = colAddr(tc)
  let nextTr: Element | null = null
  for (let n = tr.nextSibling; n; n = n.nextSibling) {
    if (n.nodeType === 1 && lname(n) === 'tr') { nextTr = n as Element; break }
  }
  if (!nextTr) return null
  const below = childEls(nextTr, 'tc')
  if (col != null) {
    const hit = below.find((c) => colAddr(c) === col)
    if (hit) return hit
  }
  return below[idx] ?? null
}

function cellParas(tc: Element): Element[] {
  const sub = childEls(tc, 'subList')[0]
  return sub ? childEls(sub, 'p') : []
}

// ── 본체 ──────────────────────────────────────────────────────
interface Cand {
  doc: Document
  p: Element
  n: string
}

function splitLines(answer: string): string[] {
  const lines = answer.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, ''))
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines.length ? lines : ['']
}

export async function fillHwpx(template: Buffer, items: HwpxFillItem[]): Promise<HwpxFillResult> {
  const zip = await JSZip.loadAsync(template)
  const sectionNames = Object.keys(zip.files)
    .filter((n) => SECTION_RE.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)?.[1]) - Number(b.match(/(\d+)/)?.[1]))
  if (sectionNames.length === 0) {
    throw new Error('HWPX 양식에서 Contents/section*.xml을 찾을 수 없습니다.')
  }

  const parser = new DOMParser({
    errorHandler: { warning: () => {}, error: () => {}, fatalError: (e: unknown) => { throw e } },
  })
  const docs = new Map<string, Document>()
  const cands: Cand[] = []
  for (const name of sectionNames) {
    const xml = await zip.files[name].async('text')
    const doc = parser.parseFromString(xml, 'text/xml')
    docs.set(name, doc)
    for (const p of descendants(doc.documentElement, 'p')) {
      const n = norm(ownText(p))
      if (n) cands.push({ doc, p, n })
    }
  }

  const skippedMissing: string[] = []
  const work: Array<{ question: string; lines: string[]; nq: string }> = []
  for (const it of items) {
    const answer = (it.answer ?? '').trim()
    if (!answer || answer.includes(MISSING_PREFIX)) {
      skippedMissing.push(it.question)
      continue
    }
    work.push({ question: it.question, lines: splitLines(answer), nq: norm(it.question) })
  }

  // 문항처럼 보이는 문단 (표에서 "머리글 행"인지 판별할 때 사용)
  const looksLikeQuestion = new Set<Element>()
  for (const c of cands) {
    if (work.some((w) => similarity(c.n, w.nq) >= MATCH_THRESHOLD)) looksLikeQuestion.add(c.p)
  }
  const isQuestionCell = (tc: Element) => cellParas(tc).some((p) => looksLikeQuestion.has(p))

  const used = new Set<number>()
  const unmatched: Array<{ question: string; lines: string[] }> = []
  let filled = 0
  let last = -1

  for (const w of work) {
    let best = -1
    let bestScore = 0
    for (let j = 0; j < cands.length; j++) {
      if (used.has(j)) continue
      const s = similarity(cands[j].n, w.nq)
      if (s < MATCH_THRESHOLD) continue
      // 더 높은 점수 우선, 동점이면 직전 매칭 이후 위치를 우선
      if (s > bestScore + 1e-9 || (Math.abs(s - bestScore) < 1e-9 && best <= last && j > last)) {
        best = j
        bestScore = s
      }
    }
    if (best < 0) {
      unmatched.push({ question: w.question, lines: w.lines })
      continue
    }
    used.add(best)
    last = best
    const c = cands[best]
    place(c.doc, c.p, w.lines, isQuestionCell)
    filled++
  }

  // 못 찾은 문항은 마지막 구역 끝에 모아서 붙인다
  if (unmatched.length > 0) {
    const doc = docs.get(sectionNames[sectionNames.length - 1])!
    const topParas = childEls(doc.documentElement, 'p')
    let ref = topParas[topParas.length - 1]
    if (ref) {
      ref = insertParaAfter(doc, ref, '')
      setParaText(doc, ref, '※ 양식에서 위치를 찾지 못한 항목')
      for (const u of unmatched) {
        ref = insertParaAfter(doc, ref, `[문항] ${u.question}`)
        for (const line of u.lines) ref = insertParaAfter(doc, ref, line)
      }
    }
  }

  const serializer = new XMLSerializer()
  docs.forEach((doc, name) => {
    zip.file(name, XML_DECL + serializer.serializeToString(doc.documentElement))
  })
  // HWPX 규격: mimetype은 압축 없이 저장
  if (zip.files['mimetype']) {
    const mt = await zip.files['mimetype'].async('string')
    zip.file('mimetype', mt, { compression: 'STORE' })
  }

  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return {
    buffer: out,
    filled,
    skippedMissing,
    unmatched: unmatched.map((u) => u.question),
  }
}

function place(
  doc: Document,
  p: Element,
  lines: string[],
  isQuestionCell: (tc: Element) => boolean,
) {
  const tc = closest(p, 'tc')
  if (tc) {
    const right = nextCellInRow(tc)
    const below = cellBelow(tc)
    const target =
      right && !isQuestionCell(right) ? right : below && !isQuestionCell(below) ? below : null
    if (target) return fillCell(doc, target, lines)
  }
  fillInline(doc, p, lines)
}

function fillCell(doc: Document, tc: Element, lines: string[]) {
  const paras = cellParas(tc)
  if (paras.length === 0) return
  const hasText = paras.some((p) => ownText(p).trim() !== '')
  let ref: Element
  let rest: string[]
  if (!hasText) {
    setParaText(doc, paras[0], lines[0])
    ref = paras[0]
    rest = lines.slice(1)
  } else {
    // 기존 안내문이 있으면 지우지 않고 아래에 이어서 붙인다
    ref = paras[paras.length - 1]
    rest = lines
  }
  for (const line of rest) ref = insertParaAfter(doc, ref, line)
}

const BLANK_TAIL = /(?:[_＿]{2,}|\.{3,}|…+|\(\s{2,}\)|\[\s{2,}\])\s*$/

function fillInline(doc: Document, p: Element, lines: string[]) {
  const ts = ownTs(p)
  const lastT = ts[ts.length - 1]
  if (lastT && lines.length === 1) {
    const text = tText(lastT)
    if (BLANK_TAIL.test(text)) {
      setTText(doc, lastT, text.replace(BLANK_TAIL, lines[0]))
      dropLineSegs(p)
      return
    }
    if (/[:：]\s*$/.test(ownText(p).trim())) {
      appendParaText(doc, p, lines[0])
      return
    }
  }
  let ref = p
  for (const line of lines) ref = insertParaAfter(doc, ref, line)
}
