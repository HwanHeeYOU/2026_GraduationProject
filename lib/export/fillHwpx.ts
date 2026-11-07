/**
 * 업로드한 기관 양식(.hwpx)에 AI 초안 답변을 채워 넣는다.
 *
 * HWPX = ZIP( Contents/section*.xml, header.xml, ... ).
 * 본문은 <hp:p>(문단) 안의 <hp:run><hp:t>텍스트</hp:t></hp:run> 구조이고,
 * 표는 <hp:tbl><hp:tr><hp:tc><hp:subList><hp:p>… 로 중첩된다.
 *
 * 전략
 *  1) 모든 문단의 텍스트를 문항(question)과 유사도 매칭한다.
 *  2) 문항이 표 셀 안에 있으면 → 병합(rowSpan/colSpan)을 반영한 논리 격자에서
 *     오른쪽의 "빈" 셀(바로 오른쪽이 다른 문항 라벨이면 아래의 빈 셀)에 답변을 넣는다.
 *     텍스트가 이미 있는 셀(라벨/기존 답변)은 덮어쓰지 않고 건너뛰며,
 *     안전한 칸을 못 찾으면 라벨 셀은 그대로 두고 문서 끝 모음(4번)으로 보낸다.
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

// ── 표 셀 탐색 (병합 셀 인식) ─────────────────────────────────
interface GridCell {
  tc: Element
  row: number
  col: number
  rowSpan: number
  colSpan: number
}

interface TableGrid {
  cells: GridCell[]
  /** "행,열" → 그 칸을 덮고 있는 셀 (병합 셀은 덮는 모든 칸에서 같은 셀) */
  at: Map<string, GridCell>
  byTc: Map<Element, GridCell>
}

function intAttr(el: Element | undefined, name: string): number | null {
  const v = el?.getAttribute(name)
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const gridCache = new WeakMap<Element, TableGrid>()

/**
 * 표의 논리 격자를 만든다.
 * cellAddr(colAddr/rowAddr)가 있으면 그 값을, 없으면 cellSpan으로 점유 격자를 따라 위치를 계산한다.
 */
function buildGrid(tbl: Element): TableGrid {
  const cached = gridCache.get(tbl)
  if (cached) return cached

  const cells: GridCell[] = []
  const at = new Map<string, GridCell>()
  const byTc = new Map<Element, GridCell>()
  const occupied = new Set<string>()

  childEls(tbl, 'tr').forEach((tr, rowIdx) => {
    let cursor = 0
    for (const tc of childEls(tr, 'tc')) {
      const span = childEls(tc, 'cellSpan')[0]
      const addr = childEls(tc, 'cellAddr')[0]
      const colSpan = Math.max(1, intAttr(span, 'colSpan') ?? 1)
      const rowSpan = Math.max(1, intAttr(span, 'rowSpan') ?? 1)
      let row = intAttr(addr, 'rowAddr')
      let col = intAttr(addr, 'colAddr')
      if (row == null || col == null) {
        // 위쪽 병합 셀이 차지한 칸은 건너뛴다
        while (occupied.has(`${rowIdx},${cursor}`)) cursor++
        row = rowIdx
        col = cursor
      }
      const gc: GridCell = { tc, row, col, rowSpan, colSpan }
      cells.push(gc)
      byTc.set(tc, gc)
      for (let r = row; r < row + rowSpan; r++) {
        for (let c = col; c < col + colSpan; c++) {
          const key = `${r},${c}`
          occupied.add(key)
          if (!at.has(key)) at.set(key, gc)
        }
      }
      cursor = col + colSpan
    }
  })

  const grid = { cells, at, byTc }
  gridCache.set(tbl, grid)
  return grid
}

function cellParas(tc: Element): Element[] {
  const sub = childEls(tc, 'subList')[0]
  return sub ? childEls(sub, 'p') : []
}

// ── 셀 내용 분류 ──────────────────────────────────────────────
/** 밑줄/점선 같은 빈칸 표시만 있는 텍스트 */
const PLACEHOLDER_ONLY = /^(?:[\s_＿.…·\-()[\]]|\u00a0)*$/

/** 양식의 안내 문구 표식: "*소속 대학 및 학과 기술", "※ …", "예) …" */
const GUIDE_MARK = /^\s*(?:[*＊※]|예\s*[)）:：]|e\.?g\.?\s*[:)])/i
/** 안내 문구 어미: "~기재하십시오", "~입력 바랍니다" */
const GUIDE_END = /(?:하십시오|하세요|해\s*주세요|바랍니다|요망|할\s*것)[\s.。]*$/
/** 긴 괄호 안내문: "(해당되는 경우에만 기재)" — "(필수)" 같은 짧은 표식은 제외 */
const GUIDE_PAREN = /^\s*[(（[【].{8,}[)）\]】]\s*$/
/** 하위 라벨: "휴대전화 :", "연구실 : ____" (콜론 뒤에 빈칸 표시뿐) */
const SUBLABEL = /^\s*[^:：]{1,24}?\s*[:：]\s*(?:[_＿.…\s]|\u00a0)*$/

type ParaKind = 'blank' | 'guide' | 'sublabel' | 'content'
type CellKind = 'empty' | 'guide' | 'sublabels' | 'content'

/** header.xml 에서 읽은 글자 스타일 정보 (안내문의 파란색 판별 · 어두운 대체 스타일 찾기) */
interface StyleInfo {
  blue: Set<string>
  darkAlt: Map<string, string>
}
const EMPTY_STYLE: StyleInfo = { blue: new Set(), darkAlt: new Map() }

function parseColor(v: string | null): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(v ?? '')
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function readStyleInfo(headerDoc: Document | null): StyleInfo {
  if (!headerDoc) return EMPTY_STYLE
  const blue = new Set<string>()
  const darkAlt = new Map<string, string>()
  const serializer = new XMLSerializer()
  const entries: Array<{ id: string; sig: string; blue: boolean; dark: boolean }> = []
  for (const pr of descendants(headerDoc.documentElement, 'charPr')) {
    const id = pr.getAttribute('id')
    if (id == null) continue
    const rgb = parseColor(pr.getAttribute('textColor'))
    const isBlue = !!rgb && rgb[2] >= 150 && rgb[0] <= 100 && rgb[1] <= 140
    const isDark = !rgb || (rgb[0] <= 60 && rgb[1] <= 60 && rgb[2] <= 60)
    // 색과 id 를 뺀 나머지(글꼴·크기·굵기 …)가 같은 스타일끼리 짝지음
    const clone = pr.cloneNode(true) as Element
    clone.removeAttribute('id')
    clone.removeAttribute('textColor')
    entries.push({ id, sig: serializer.serializeToString(clone), blue: isBlue, dark: isDark })
  }
  for (const e of entries) {
    if (!e.blue) continue
    blue.add(e.id)
    const alt = entries.find((o) => o.dark && o.sig === e.sig)
    if (alt) darkAlt.set(e.id, alt.id)
  }
  return { blue, darkAlt }
}

/** 문단의 글자가 전부 파란색인가 (양식의 안내 문구 관례) */
function paraIsBlue(p: Element, style: StyleInfo): boolean {
  if (style.blue.size === 0) return false
  let any = false
  for (const run of childEls(p, 'run')) {
    const text = childEls(run, 't').map(tText).join('')
    if (!text.trim()) continue
    if (!style.blue.has(run.getAttribute('charPrIDRef') ?? '')) return false
    any = true
  }
  return any
}

function classifyPara(p: Element, style: StyleInfo): ParaKind {
  const text = ownText(p).trim()
  if (PLACEHOLDER_ONLY.test(text)) return 'blank'
  if (GUIDE_MARK.test(text) || GUIDE_PAREN.test(text)) return 'guide'
  if (SUBLABEL.test(text)) return 'sublabel'
  if (GUIDE_END.test(text) || paraIsBlue(p, style)) return 'guide'
  return 'content'
}

/**
 * 답변을 넣을 후보 셀을 분류한다.
 *  empty     비었거나 밑줄뿐        → 그대로 채움
 *  guide     양식의 안내 문구       → 지우고 답변으로 덮어씀
 *  sublabels "휴대전화 :" 같은 하위 라벨 → 라벨 뒤에 이어 붙임
 *  content   다른 라벨/이미 쓴 답/표 등 → 건드리지 않음
 */
function classifyCell(tc: Element, isQuestionCell: (tc: Element) => boolean, style: StyleInfo): CellKind {
  if (isQuestionCell(tc)) return 'content'
  if (descendants(tc, 'tbl').length > 0) return 'content'
  const paras = cellParas(tc)
  if (paras.length === 0) return 'content'
  const kinds = paras.map((p) => classifyPara(p, style))
  if (kinds.every((k) => k === 'blank')) return 'empty'
  if (kinds.some((k) => k === 'content')) return 'content'
  if (kinds.some((k) => k === 'sublabel')) return 'sublabels'
  return 'guide'
}

// ── 오른쪽/아래 대상 셀 탐색 ──────────────────────────────────
const MAX_SKIP = 3

type Found = { tc: Element; kind: CellKind } | 'blocked' | null
type Classify = (tc: Element) => CellKind

function findRight(
  grid: TableGrid,
  origin: GridCell,
  classify: Classify,
  isQuestionCell: (tc: Element) => boolean,
): Found {
  let col = origin.col + origin.colSpan
  let skipped = 0
  let first = true
  for (;;) {
    const cell = grid.at.get(`${origin.row},${col}`)
    if (!cell) return null // 표의 오른쪽 끝
    // 시작 행이 다르면 다른 줄에 걸친 병합 셀 → 안전하게 위치를 특정할 수 없다
    if (cell.row !== origin.row) return 'blocked'
    const kind = classify(cell.tc)
    if (kind !== 'content') return { tc: cell.tc, kind }
    // 바로 오른쪽이 다른 문항 라벨이면 머리글 행 → 아래 칸을 본다
    if (first && isQuestionCell(cell.tc)) return null
    // 큰 병합 라벨(그룹 제목) 옆의 하위 라벨은 건너뛰어 추측하지 않는다
    if (origin.rowSpan > 1) return 'blocked'
    first = false
    if (++skipped > MAX_SKIP) return 'blocked'
    col = cell.col + cell.colSpan
  }
}

function findBelow(grid: TableGrid, origin: GridCell, classify: Classify): Found {
  let row = origin.row + origin.rowSpan
  let skipped = 0
  for (;;) {
    const cell = grid.at.get(`${row},${origin.col}`)
    if (!cell) return null // 표의 아래쪽 끝
    if (cell.row !== row) return 'blocked'
    const kind = classify(cell.tc)
    if (kind !== 'content') return { tc: cell.tc, kind }
    if (++skipped > MAX_SKIP) return 'blocked'
    row = cell.row + cell.rowSpan
  }
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

  // 안내문(파란 글씨) 판별용 글자 스타일 — header.xml 이 없거나 읽기 실패해도 동작은 유지
  let style: StyleInfo = EMPTY_STYLE
  const headerName = Object.keys(zip.files).find((n) => /^Contents\/header\.xml$/i.test(n))
  if (headerName) {
    try {
      style = readStyleInfo(parser.parseFromString(await zip.files[headerName].async('text'), 'text/xml'))
    } catch { /* 스타일 정보 없이 진행 */ }
  }

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
    if (place(c.doc, c.p, w.lines, isQuestionCell, style)) filled++
    else unmatched.push({ question: w.question, lines: w.lines })
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

/**
 * 문항 문단의 답변 위치를 찾아 채운다. 채웠으면 true.
 * 표 셀 안의 라벨인데 안전한 대상 칸을 못 찾으면 false (라벨 셀은 건드리지 않고 호출부가 문서 끝에 모은다).
 */
function place(
  doc: Document,
  p: Element,
  lines: string[],
  isQuestionCell: (tc: Element) => boolean,
  style: StyleInfo,
): boolean {
  const tc = closest(p, 'tc')
  const tbl = tc ? closest(tc, 'tbl') : null
  if (tc && tbl) {
    // 문항 자체가 한 셀 안의 여러 하위 라벨("휴대전화 :", "연구실 :") 중 하나면 그 라벨 뒤에 바로 이어 붙인다
    if (
      classifyPara(p, style) === 'sublabel' &&
      // 이미 앞 라벨이 채워져 "라벨 : 값" 이 된 문단도 하위 라벨로 센다
      cellParas(tc).filter((q) => /^\s*[^:：]{1,24}?\s*[:：]/.test(ownText(q))).length >= 2
    ) {
      fillInline(doc, p, lines)
      return true
    }

    const grid = buildGrid(tbl)
    const origin = grid.byTc.get(tc)
    if (!origin) return false
    const classify: Classify = (c) => classifyCell(c, isQuestionCell, style)

    const right = findRight(grid, origin, classify, isQuestionCell)
    if (right && right !== 'blocked') return fillCell(doc, right.tc, right.kind, lines, style)
    if (right === 'blocked') return false
    const below = findBelow(grid, origin, classify)
    if (below && below !== 'blocked') return fillCell(doc, below.tc, below.kind, lines, style)
    return false
  }
  fillInline(doc, p, lines)
  return true
}

function hasNonTextContent(p: Element): boolean {
  return descendants(p, 'tbl').length > 0 || descendants(p, 'pic').length > 0
}

/** 안내문을 지운 문단이 파란 글씨라면, 같은 서식의 어두운 스타일로 바꾼다 (답변이 파랗게 보이지 않도록). */
function recolorIfBlue(p: Element, style: StyleInfo) {
  for (const run of childEls(p, 'run')) {
    const id = run.getAttribute('charPrIDRef') ?? ''
    const alt = style.darkAlt.get(id)
    if (alt) run.setAttribute('charPrIDRef', alt)
  }
}

/**
 * 대상 셀에 답변을 쓴다. 텍스트 노드(<t>)만 바꾸고 run/문단/셀 서식 속성은 유지한다.
 *  empty     → 첫 문단에 쓴다
 *  guide     → 안내문을 지우고 덮어쓴다
 *  sublabels → 하위 라벨 뒤에 이어 붙인다 (라벨은 그대로)
 */
function fillCell(
  doc: Document,
  tc: Element,
  kind: CellKind,
  lines: string[],
  style: StyleInfo,
): boolean {
  const paras = cellParas(tc)
  if (paras.length === 0) return false

  if (kind === 'sublabels') return fillSubLabels(doc, paras, lines, style)

  let keep = paras[0]
  if (kind === 'guide') {
    // 안내문이 있는 첫 문단을 남기고, 다른 안내/빈 문단은 제거 (표·그림이 든 문단은 보존)
    keep = paras.find((p) => classifyPara(p, style) === 'guide') ?? paras[0]
    for (const p of paras) {
      if (p !== keep && !hasNonTextContent(p)) p.parentNode?.removeChild(p)
    }
    recolorIfBlue(keep, style)
  }
  setParaText(doc, keep, lines[0])
  let ref = keep
  for (const line of lines.slice(1)) ref = insertParaAfter(doc, ref, line)
  return true
}

/** "휴대전화 : 010-…" 처럼 "라벨: 값" 형태의 줄을 (라벨, 값)으로 분리 */
function splitKeyed(line: string): { key: string; value: string } | null {
  const m = /^\s*([^:：]{1,24}?)\s*[:：]\s*(.*)$/.exec(line)
  return m ? { key: norm(m[1]), value: m[2].trim() } : null
}

/** 하위 라벨 문단 뒤에 값을 이어 붙인다. 마지막 글자 노드(<t>)의 텍스트만 바꾼다. */
function appendAfterLabel(doc: Document, p: Element, value: string) {
  const ts = ownTs(p)
  let target: Element | null = null
  for (let i = ts.length - 1; i >= 0; i--) {
    if (tText(ts[i]).trim() !== '') { target = ts[i]; break }
  }
  if (!target) return
  const text = tText(target)
  if (BLANK_TAIL.test(text)) {
    setTText(doc, target, text.replace(BLANK_TAIL, value))
  } else {
    setTText(doc, target, text.replace(/[\s\u00a0]+$/, '') + ' ' + value)
  }
  dropLineSegs(p)
}

/**
 * 하위 라벨이 든 셀에 답변 배분.
 *  1) "라벨: 값" 형태의 줄은 이름이 같은 하위 라벨에 넣는다
 *  2) 나머지 줄은 나머지 라벨과 개수가 같을 때만 순서대로 넣는다
 *  3) 하위 라벨이 하나뿐이면 전체 답변을 그 뒤에 이어 붙인다
 *  어느 것도 안전하게 짝지을 수 없으면 아무것도 쓰지 않고 false.
 */
function fillSubLabels(doc: Document, paras: Element[], lines: string[], style: StyleInfo): boolean {
  const subs = paras.filter((p) => classifyPara(p, style) === 'sublabel')
  if (subs.length === 0) return false

  const labelKey = (p: Element) => norm(ownText(p).replace(/[:：][\s\S]*$/, ''))
  const assigned = new Map<Element, string>()
  const looseLines: string[] = []

  for (const line of lines) {
    const kv = splitKeyed(line)
    const hit = kv && subs.find((p) => !assigned.has(p) && labelKey(p) === kv.key)
    if (kv && hit && kv.value) assigned.set(hit, kv.value)
    else if (line.trim()) looseLines.push(line.trim())
  }

  const freeSubs = subs.filter((p) => !assigned.has(p))
  if (looseLines.length > 0) {
    if (assigned.size === 0 && freeSubs.length === 1) {
      assigned.set(freeSubs[0], looseLines.join(' '))
    } else if (looseLines.length === freeSubs.length) {
      freeSubs.forEach((p, i) => assigned.set(p, looseLines[i]))
    }
  }

  if (assigned.size === 0) return false
  assigned.forEach((value, p) => appendAfterLabel(doc, p, value))
  return true
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
