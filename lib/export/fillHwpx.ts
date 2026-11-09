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
/** 1차 매칭에 실패한 문항을 한 번 더 찾을 때 쓰는 완화된 기준 */
const RELAXED_THRESHOLD = 0.42
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
    // 양식의 작성 안내("(필요시 칸을 추가하여 …)")와 AI 문항의 꼬리표("- 여러 건 입력")는 라벨 비교에서 제외
    .replace(/[(（]\s*필요\s*시[^)）]*[)）]/g, '')
    .replace(/\s*[-–—:]?\s*여러\s*건\s*입력\s*$/, '')
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
/** 날짜 기입 안내: "    년  월부터", "년  월까지", "년 월 일" — 숫자 없이 단위 글자만 있는 칸 */
const DATE_PLACEHOLDER = /^[\s _＿.…·\-~()]*(?:(?:년|월|일|부터|까지)[\s _＿.…·\-~()]*)+$/
const GUIDE_MARK = /^\s*(?:[*＊※]|예\s*[)）:：]|e\.?g\.?\s*[:)])/i
/** 안내 문구 어미: "~기재하십시오", "~입력 바랍니다" */
const GUIDE_END = /(?:하십시오|하세요|해\s*주세요|바랍니다|요망|할\s*것)[\s.。]*$/
/** 긴 괄호 안내문: "(해당되는 경우에만 기재)" — "(필수)" 같은 짧은 표식은 제외 */
const GUIDE_PAREN = /^\s*[(（[【].{8,}[)）\]】]\s*$/
/** 하위 라벨: "휴대전화 :", "연구실 : ____" (콜론 뒤에 빈칸 표시뿐) */
const SUBLABEL = /^\s*[^:：]{1,24}?\s*[:：]\s*(?:[_＿.…\s]|\u00a0)*$/

/** 자리표시 문구: "대학/대학원      학과/학부" — 공백을 크게 띄워 두 칸처럼 보이게 한 "A/B   C/D" 형태 */
const SLASH_PLACEHOLDER = /^[^\s/]{1,12}\/[^\s/]{1,12}\s{3,}[^\s/]{1,12}\/[^\s/]{1,12}$/

/** 체크박스 한 개 */
const BOX_RE = /[□☐]/g

type ParaKind = 'blank' | 'guide' | 'sublabel' | 'content'
type CellKind = 'empty' | 'guide' | 'sublabels' | 'choices' | 'content'

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
  if (DATE_PLACEHOLDER.test(text) || SLASH_PLACEHOLDER.test(text)) return 'guide'
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
 *  choices   "□ 교수  □ 박사과정" 같은 선택지 → 답변과 맞는 항목에 체크
 *  content   다른 라벨/이미 쓴 답/표 등 → 건드리지 않음
 */
function classifyCell(tc: Element, isQuestionCell: (tc: Element) => boolean, style: StyleInfo): CellKind {
  if (isQuestionCell(tc)) return 'content'
  if (descendants(tc, 'tbl').length > 0) return 'content'
  const paras = cellParas(tc)
  if (paras.length === 0) return 'content'
  if ((paras.map(ownText).join('\n').match(BOX_RE) ?? []).length >= 2) return 'choices'
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

// ── 열 머리글이 있는 "여러 건 입력" 표 ─────────────────────────
/** 행 번호만 든 칸인가: n번째 행의 "n", "n.", "n)", "①"(n=1) */
function isRowNumber(text: string, n: number): boolean {
  const t = text.trim()
  const m = /^(\d{1,3})\s*[.)]?$/.exec(t)
  if (m) return Number(m[1]) === n
  return t.length === 1 && t.charCodeAt(0) - 0x2460 + 1 === n
}

interface ColumnSpec {
  title: string
  columns: string[]
}

/** "표 이름 (열1 / 열2 / 열3) - 여러 건 입력" → 표 이름과 열 이름들 */
function parseColumnSpec(question: string): ColumnSpec | null {
  const groups = Array.from(question.matchAll(/[(（]([^()（）]*\/[^()（）]*)[)）]/g))
  if (groups.length === 0) {
    // AI 가 괄호·표 이름을 빠뜨린 "열1 / 열2 / 열3 - 여러 건 입력" 형태. 오탐을 막으려고 표식이 있을 때만 인정한다.
    const m = question.match(/^(.*?)\s*[-–—:]?\s*여러\s*건\s*입력\s*$/)
    if (!m || !m[1].includes('/')) return null
    const columns = m[1].split('/').map((c) => c.trim()).filter(Boolean)
    return columns.length >= 2 ? { title: '', columns } : null
  }
  const g = groups[groups.length - 1]
  const columns = g[1].split('/').map((c) => c.trim()).filter(Boolean)
  if (columns.length < 2) return null
  return { title: question.slice(0, g.index).trim(), columns }
}

function cellText(tc: Element): string {
  return cellParas(tc).map(ownText).join(' ').trim()
}

/** 표 바로 앞 문단의 글 (표 제목 후보) */
function textBeforeTable(tbl: Element): string {
  let el: Node | null = tbl
  while (el && lname(el) !== 'p') el = el.parentNode
  for (let prev = el?.previousSibling ?? null; prev; prev = prev.previousSibling) {
    if (prev.nodeType === 1 && lname(prev) === 'p') {
      const t = ownText(prev as Element).trim()
      if (t) return t
    }
  }
  return ''
}

/** 열 이름 하나에 맞는 머리글 셀 */
function matchHeaderCell(cells: GridCell[], col: string, taken: Set<GridCell>): GridCell | null {
  const nc = norm(col)
  let best: GridCell | null = null
  let bestScore = 0
  for (const c of cells) {
    if (taken.has(c)) continue
    const nt = norm(cellText(c.tc))
    if (!nt) continue
    const sc = similarity(nt, nc)
    if (sc > bestScore) { bestScore = sc; best = c }
  }
  return bestScore >= 0.75 ? best : null
}

/** 모든 열 이름이 한 행에서 발견되는 머리글 행. cols 는 질문의 열 순서와 같다. */
function findHeader(
  tbl: Element,
  columns: string[],
  usedHeaders: Set<Element>,
): { row: number; cols: GridCell[] } | null {
  const grid = buildGrid(tbl)
  const rows = new Map<number, GridCell[]>()
  for (const c of grid.cells) {
    if (!rows.has(c.row)) rows.set(c.row, [])
    rows.get(c.row)!.push(c)
  }
  for (const [row, cells] of Array.from(rows.entries()).sort((a, b) => a[0] - b[0])) {
    const taken = new Set<GridCell>()
    const cols: GridCell[] = []
    for (const col of columns) {
      const m = matchHeaderCell(cells, col, taken)
      if (!m) break
      taken.add(m)
      cols.push(m)
    }
    // 이미 다른 문항이 채운 머리글 행은 건너뛴다 (여러 소제목의 표가 한 표로 이어진 양식 대응)
    if (cols.length === columns.length && !cols.some((c) => usedHeaders.has(c.tc))) return { row, cols }
  }
  return null
}

/** 한 줄 → 열 개수에 맞춘 값들. 값이 더 많으면 남는 값은 마지막 열에 합친다. */
function splitRow(line: string, n: number): string[] {
  const text = line.replace(/^\s*(?:[-•·○●▪※]|\d{1,2}[.)])\s+/, '').trim()
  let parts = text.split(/\s+\/\s+/).map((x) => x.trim())
  if (parts.length !== n) {
    const loose = text.split('/').map((x) => x.trim())
    if (loose.length === n) parts = loose
  }
  if (parts.length > n) parts = [...parts.slice(0, n - 1), parts.slice(n - 1).join(' / ')]
  while (parts.length < n) parts.push('')
  return parts
}

/** 마지막 빈 행을 복제해 그 뒤에 넣는다. 병합·표·그림이 든 행이면 null. */
function cloneRowAfter(tbl: Element, tr: Element, row: number): Element | null {
  for (const tc of childEls(tr, 'tc')) {
    const sp = childEls(tc, 'cellSpan')[0]
    if ((intAttr(sp, 'rowSpan') ?? 1) > 1) return null
    if (descendants(tc, 'tbl').length > 0 || descendants(tc, 'pic').length > 0) return null
  }
  const clone = tr.cloneNode(true) as Element
  for (const tc of childEls(clone, 'tc')) {
    const addr = childEls(tc, 'cellAddr')[0]
    if (addr) addr.setAttribute('rowAddr', String(row + 1))
    const doc = tc.ownerDocument!
    for (const p of cellParas(tc)) {
      for (const t of ownTs(p)) setTText(doc, t, '')
      dropLineSegs(p)
    }
  }
  // 뒤따르는 행들의 행 번호를 하나씩 민다
  for (const tc of descendants(tbl, 'tc')) {
    if (closest(tc, 'tbl') !== tbl) continue
    const addr = childEls(tc, 'cellAddr')[0]
    const r = intAttr(addr, 'rowAddr')
    if (addr && r != null && r > row) addr.setAttribute('rowAddr', String(r + 1))
  }
  tr.parentNode!.insertBefore(clone, tr.nextSibling)
  const cnt = intAttr(tbl, 'rowCnt')
  if (cnt != null) tbl.setAttribute('rowCnt', String(cnt + 1))
  gridCache.delete(tbl)
  return clone
}

/**
 * 열 머리글 아래로 채우는 표에 답변을 행 단위로 넣는다 (한 줄 = 한 행, " / " 로 열 구분).
 * 반환: null = 맞는 표를 못 찾음(기존 방식으로 처리), 배열 = 표에 못 넣고 남은 줄들.
 */
function fillColumnTable(
  docs: Document[],
  spec: ColumnSpec,
  lines: string[],
  isQuestionCell: (tc: Element) => boolean,
  style: StyleInfo,
  usedHeaders: Set<Element>,
): string[] | null {
  let best: { tbl: Element; doc: Document; header: { row: number; cols: GridCell[] }; score: number } | null = null
  const nTitle = norm(spec.title)
  for (const doc of docs) {
    for (const tbl of descendants(doc.documentElement, 'tbl')) {
      const header = findHeader(tbl, spec.columns, usedHeaders)
      if (!header) continue
      // 같은 머리글의 표가 여럿이면 앞 문단 제목이 문항과 비슷한 쪽을 고른다
      const score = nTitle ? similarity(norm(textBeforeTable(tbl)), nTitle) : 0
      if (!best || score > best.score) best = { tbl, doc, header, score }
    }
  }
  if (!best) return null

  const { tbl, doc, header } = best
  const grid = buildGrid(tbl)
  const headerBottom = Math.max(...header.cols.map((c) => c.row + c.rowSpan))
  const rowsCount = Math.max(...grid.cells.map((c) => c.row + c.rowSpan))
  // 열 표에서는 미리 인쇄된 행 번호("1", "2.", "③")만 든 칸도 값을 덮어쓸 수 있는 칸으로 본다
  // 단, 머리글 아래 n번째 행에서 값이 정확히 n 일 때만 행 번호로 본다 (합계 줄의 "0" 같은 값은 내용으로 남긴다)
  const numberCells = new Set<Element>()
  const classify = (c: Element, nth: number): CellKind => {
    const kind = classifyCell(c, isQuestionCell, style)
    if (kind === 'content' && isRowNumber(cellText(c), nth)) {
      numberCells.add(c)
      return 'guide'
    }
    return kind
  }

  // 머리글 아래에서 대상 칸이 모두 비어 있는(또는 안내문뿐인) 연속된 행들. 질문의 열 순서로 보관.
  const rowTargets: Array<Array<{ tc: Element; kind: CellKind }>> = []
  for (let r = headerBottom; r < rowsCount; r++) {
    const targets: Array<{ tc: Element; kind: CellKind }> = []
    for (const hc of header.cols) {
      const cell = grid.at.get(`${r},${hc.col}`)
      if (!cell || cell.row !== r) break
      const kind = classify(cell.tc, r - headerBottom + 1)
      if (kind !== 'empty' && kind !== 'guide') break
      targets.push({ tc: cell.tc, kind })
    }
    if (targets.length !== header.cols.length) break
    rowTargets.push(targets)
  }
  if (rowTargets.length === 0) return null

  // 모든 행에 번호가 미리 인쇄된 열(예: 지출내역의 "구분" 1, 2, 3 …)은 번호 열이다. 번호는 건드리지 않는다.
  const numberCols = new Set<number>()
  header.cols.forEach((_, k) => {
    if (rowTargets.every((row) => numberCells.has(row[k].tc))) numberCols.add(k)
  })
  if (numberCols.size === header.cols.length) numberCols.clear()

  for (const hc of header.cols) usedHeaders.add(hc.tc)
  const nonEmpty = splitBar(lines)
  const leftover: string[] = []
  let lastRow = headerBottom + rowTargets.length - 1
  for (let i = 0; i < nonEmpty.length; i++) {
    if (i >= rowTargets.length) {
      // 행이 모자라면 마지막 빈 행을 복제해 늘린다
      const lastTr = closest(rowTargets[rowTargets.length - 1][0].tc, 'tr')
      const clone = lastTr ? cloneRowAfter(tbl, lastTr, lastRow) : null
      if (!clone) { leftover.push(...nonEmpty.slice(i)); break }
      lastRow++
      const tcs = childEls(clone, 'tc')
      rowTargets.push(
        header.cols.map((hc) => ({
          tc: tcs.find((tc) => intAttr(childEls(tc, 'cellAddr')[0], 'colAddr') === hc.col) ?? tcs[0],
          kind: 'empty' as CellKind,
        })),
      )
      // 복제한 행의 번호 칸은 앞 행 번호에 이어서 매긴다 (7 → 8, "7." → "8."). 열 목록 밖의 번호 열도 포함.
      const prevTcs = lastTr ? childEls(lastTr, 'tc') : []
      const nth = rowTargets.length - 1 // 앞 행이 머리글 아래 몇 번째 행인지
      prevTcs.forEach((ptc, idx) => {
        const m = /^\s*(\d{1,3})\s*([.)]?)\s*$/.exec(cellText(ptc))
        if (m && Number(m[1]) === nth && tcs[idx]) fillCell(doc, tcs[idx], 'empty', [`${nth + 1}${m[2]}`], style)
      })
    }
    const values = splitRow(nonEmpty[i], header.cols.length)
    // 번호 열에 AI 가 값(예: "인건비")을 줬다면 번호는 두고, 그 값을 다음 열 앞에 붙인다
    numberCols.forEach((k) => {
      const v = values[k]
      values[k] = ''
      if (!v || /^\d{1,3}\s*[.)]?$/.test(v)) return
      const j = values.findIndex((_, idx) => idx > k && !numberCols.has(idx))
      if (j >= 0) values[j] = values[j] ? `${v} ${values[j]}` : v
    })
    rowTargets[i].forEach((t, k) => {
      if (numberCols.has(k)) return
      if (values[k]) fillCell(doc, t.tc, t.kind, [values[k]], style)
      // 값이 없는 칸의 작성 예시(파란 글씨 등)는 지운다. 행 번호는 그대로 둔다.
      else if (t.kind === 'guide' && !numberCells.has(t.tc)) fillCell(doc, t.tc, 'guide', [''], style)
    })
  }
  return leftover
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
      const text = ownText(p)
      const n = norm(text)
      if (n) cands.push({ doc, p, n })
      // "3. 연구기간 : IRB승인후부터 ~ 0000년 00월 00일" 처럼 라벨 뒤에 템플릿이 붙은 문단은 콜론 앞 라벨로도 찾는다
      const ci = text.search(/[:：]/)
      if (ci >= 2 && ci <= 30 && text.slice(ci + 1).trim()) {
        const ln = norm(text.slice(0, ci))
        if (ln && ln !== n) cands.push({ doc, p, n: ln })
      }
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

  // 파란 글씨 안내문("〔예시〕 …")은 칸의 이름(라벨)이 아니므로 문항 매칭 후보에서 뺀다
  const blueParas = new Set(cands.filter((c) => paraIsBlue(c.p, style)).map((c) => c.p))
  const used = new Set<number>()
  // 같은 문단이 두 후보(전체 글 / 콜론 앞 라벨)로 들어가 있으므로, 문단 단위로도 사용 여부를 기록한다
  const usedP = new Set<Element>()
  // 제목 구역 목록 — 아무것도 채우기 전에 만들어, 이번에 넣은 답변이 구역 글에 섞이지 않게 한다
  const sections = buildSections(Array.from(docs.values()), style)
  const unmatched: Array<{ question: string; lines: string[] }> = []
  let filled = 0
  let last = -1

  // 열 머리글이 있는 "여러 건 입력" 표 문항: 한 줄 = 한 행, " / " 로 열을 나눠 각 칸에 넣는다
  const sectionDocs = Array.from(docs.values())
  const usedHeaders = new Set<Element>()
  for (let i = 0; i < work.length; ) {
    const w = work[i]
    const spec = parseColumnSpec(w.question)
    const leftover = spec ? fillColumnTable(sectionDocs, spec, w.lines, isQuestionCell, style, usedHeaders) : null
    if (leftover === null) { i++; continue }
    work.splice(i, 1)
    filled++
    if (leftover.length > 0) unmatched.push({ question: w.question, lines: leftover })
  }

  // "공동연구자 성명" 처럼 병합된 그룹 칸("공동연구자") 아래의 하위 라벨("성 명") 한 줄을 가리키는 문항.
  // 구조로 정확히 찾을 수 있으므로 글자 유사도 매칭보다 먼저 처리해 그룹 칸에 잘못 붙는 일을 막는다.
  const candIndex = new Map<Element, number>(cands.map((c, j) => [c.p, j]))
  const usedSubs = new Set<Element>()
  const markUsed = (p: Element) => {
    const j = candIndex.get(p)
    if (j !== undefined) used.add(j)
    usedP.add(p)
  }

  // 1) 그룹 문항을 하위 라벨 칸에 대응시킨다. 같은 그룹 칸("공동연구자")의 문항끼리 모은다.
  interface GroupField { question: string; slot: GroupedSlot; raw: string[]; isName: boolean }
  const byGroup = new Map<Element, { tbl: Element; doc: Document; fields: GroupField[]; works: Set<(typeof work)[number]> }>()
  const claim = (nq: string): GroupedSlot | null => {
    for (const hit of groupedLabelCandidates(sectionDocs, nq)) {
      if (usedSubs.has(hit.tc)) continue
      usedSubs.add(hit.tc)
      return hit
    }
    return null
  }
  const addField = (w: (typeof work)[number], question: string, slot: GroupedSlot, raw: string[]) => {
    const e = byGroup.get(slot.g.tc) ?? { tbl: slot.tbl, doc: slot.doc, fields: [], works: new Set() }
    const label = norm(stripParen(cellText(slot.tc)))
    e.fields.push({ question, slot, raw, isName: label === '성명' || label === '이름' })
    e.works.add(w)
    byGroup.set(slot.g.tc, e)
  }
  const groupedWorks = new Set<(typeof work)[number]>()
  for (const w of work) {
    const multi = parseGroupedMulti(w.question)
    if (multi) {
      // "공동연구자 성명 / 소속 / 직위" + "박서연 / 한국대 / 부교수\n이서연 / … " (또는 " | " 로 이어짐) → 사람마다 한 줄
      const rows = splitBar(w.lines).map((l) => splitRow(l, multi.subs.length))
      multi.subs.forEach((sub, k) => {
        const slot = claim(norm(`${multi.group} ${sub}`))
        if (!slot) return
        addField(w, `${multi.group} ${sub}`, slot, rows.map((r) => r[k]))
        groupedWorks.add(w)
      })
    } else {
      const slot = claim(w.nq)
      if (!slot) continue
      addField(w, w.question, slot, splitBar(w.lines))
      groupedWorks.add(w)
    }
  }

  // 2) 그룹마다 사람 수를 정하고, 2명 이상이면 하위 라벨 묶음을 복제해 칸을 늘린 뒤 한 명씩 넣는다
  byGroup.forEach((grp) => {
    // 사람 수: 성명 칸 기준. 성명 칸이 한 줄에 " / " 로 여러 이름을 줬으면 그것도 사람 구분으로 본다
    const nameField = grp.fields.find((f) => f.isName)
    const perPerson = (f: GroupField, n: number): string[] => {
      if (f.raw.length === 1 && n > 1) {
        const parts = f.raw[0].split(/\s+\/\s+/).map((s) => s.trim()).filter(Boolean)
        if (parts.length === n) return parts
      }
      return f.raw
    }
    let n = Math.max(1, ...grp.fields.map((f) => f.raw.length))
    if (nameField) {
      const names = nameField.raw.length === 1 ? nameField.raw[0].split(/\s+\/\s+/).filter(Boolean) : nameField.raw
      n = Math.max(1, names.length)
    }
    const values = grp.fields.map((f) => perPerson(f, n))

    let blocks: Array<Map<Element, Element>> | null = []
    if (n > 1) blocks = expandGroupBlock(grp.tbl, grp.fields[0].slot.g.tc, grp.fields.map((f) => f.slot.tc), n - 1)

    grp.fields.forEach((f, k) => {
      const vals = values[k]
      let ok: boolean
      if (blocks && vals.length <= n) {
        // 첫 사람은 원래 칸, 나머지는 복제한 칸
        ok = vals.length === 0 || place(grp.doc, f.slot.p, [vals[0] ?? ''], isQuestionCell, style)
        for (let i = 1; i < vals.length && ok; i++) {
          const cloneTc = blocks[i - 1]?.get(f.slot.tc)
          const cp = cloneTc ? cellParas(cloneTc)[0] : null
          if (!cp || !vals[i]) continue
          place(grp.doc, cp, [vals[i]], isQuestionCell, style)
        }
      } else {
        // 칸을 늘릴 수 없는 구조 → 한 칸에 사람마다 한 줄
        ok = place(grp.doc, f.slot.p, vals, isQuestionCell, style)
      }
      if (ok) markUsed(f.slot.p)
      else unmatched.push({ question: f.question, lines: vals })
    })
  })
  for (let i = 0; i < work.length; ) {
    if (groupedWorks.has(work[i])) { work.splice(i, 1); filled++; continue }
    i++
  }

  const findBest = (w: { nq: string }, threshold: number) => {
    let best = -1
    let bestScore = 0
    for (let j = 0; j < cands.length; j++) {
      if (used.has(j) || usedP.has(cands[j].p) || blueParas.has(cands[j].p)) continue
      const s = similarity(cands[j].n, w.nq)
      if (s < threshold) continue
      // 더 높은 점수 우선, 동점이면 직전 매칭 이후 위치를 우선
      if (s > bestScore + 1e-9 || (Math.abs(s - bestScore) < 1e-9 && best <= last && j > last)) {
        best = j
        bestScore = s
      }
    }
    return best
  }

  // 1차: 엄격한 기준. 2차: 못 찾은 문항만 완화된 기준으로 다시 (이미 쓴 문단은 제외)
  let pending = work
  for (const threshold of [MATCH_THRESHOLD, RELAXED_THRESHOLD]) {
    const failed: typeof work = []
    for (const w of pending) {
      const best = findBest(w, threshold)
      if (best < 0) {
        failed.push(w)
        continue
      }
      used.add(best)
      usedP.add(cands[best].p)
      last = best
      const c = cands[best]
      if (place(c.doc, c.p, w.lines, isQuestionCell, style, /여러\s*건\s*입력/.test(w.question))) filled++
      else failed.push(w)
    }
    pending = failed
  }
  // 3차: 제목 구역 매칭. 문항 단어가 전부 어떤 제목 구역(제목 + 그 아래 안내문)에 들어 있으면 그 제목 아래에 넣는다.
  //  예) "개인정보 수집 항목", "개인정보 제공 여부" → "4) 개인정보 보호 및 제공에 관한 사항" 구역 (안내문에 두 말이 모두 있음)
  //      "안전대책과 보상" → "2) 연구참여로 발생할 수 있는 위험 및 손실에 대한 안전대책과 보상"
  if (pending.length > 0 && sections.length > 0) {
    const bySection = new Map<Section, typeof work>()
    const rest: typeof work = []
    for (const w of pending) {
      // 이미 다른 문항이 답을 넣은 제목 구역도 같이 쓸 수 있다 (같은 구역의 하위 문항들)
      const s = pickSection(sections, w.question, new Set())
      if (!s) { rest.push(w); continue }
      bySection.set(s, [...(bySection.get(s) ?? []), w])
    }
    bySection.forEach((ws, s) => {
      const reused = usedP.has(s.p)
      // 같은 내용이 이미 이 구역에 들어가 있으면 다시 넣지 않는다 (예: "보상계획 없음" ⊂ 앞 문항의 답)
      const existing = reused ? textAfter(s.p, 8) : ''
      const answers = ws.map((w) => norm(w.lines.join('')))
      const fresh = ws.filter((_, k) => {
        const a = answers[k]
        if (!a) return true
        if (existing.includes(a)) return false
        // 같은 묶음의 다른 답에 이미 들어 있는 내용이면 뺀다 (같은 답이면 앞의 것만 남긴다)
        return !answers.some((b, j) => j !== k && b.includes(a) && (b !== a || j < k))
      })
      filled += ws.length - fresh.length
      if (fresh.length === 0) return
      // 한 구역에 문항이 여럿이거나 이미 다른 답이 있으면 "문항: 답변" 한 줄씩으로 넣는다
      const lines =
        fresh.length === 1 && !reused
          ? fresh[0].lines
          : fresh.map((w) => `${shortLabel(w.question)}: ${w.lines.map((l) => l.trim()).filter(Boolean).join(' ')}`)
      fillInline(s.doc, s.p, lines)
      usedP.add(s.p)
      filled += fresh.length
    })
    pending = rest
  }
  for (const w of pending) unmatched.push({ question: w.question, lines: w.lines })

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
 * "공동연구자 성명 / 소속 / 직위" → 그룹 "공동연구자" + 하위 라벨 [성명, 소속, 직위].
 * 괄호가 있는 열 표 문항("근무 경력 (기간 / 소속 / 직위)")이나 하위 라벨이 긴 경우는 아님.
 */
function parseGroupedMulti(question: string): { group: string; subs: string[] } | null {
  if (/[(（]/.test(question)) return null
  const parts = question.replace(/\s*[-–—]?\s*여러\s*건\s*입력\s*$/, '').split('/').map((s) => s.trim()).filter(Boolean)
  if (parts.length < 2 || parts.length > 6) return null
  const words = parts[0].split(/\s+/)
  if (words.length < 2) return null
  const subs = [words[words.length - 1], ...parts.slice(1)]
  if (subs.some((s) => s.length > 10 || s.split(/\s+/).length > 2)) return null
  return { group: words.slice(0, -1).join(' '), subs }
}

// ── 제목 구역 (번호가 붙은 제목 + 그 아래 안내문) ────────────────
/** "4) …", "6. …", "가. …", "① …", "(1) …" 처럼 번호로 시작하는 제목 */
const HEADING_RE = /^\s*(?:\d{1,2}\s*[.)]|[가-하]\s*[.)]|[①-⑳]|\(\d{1,2}\))\s*\S/

interface Section {
  doc: Document
  /** 제목 문단 — 답변은 이 문단 바로 뒤에 들어간다 */
  p: Element
  head: string
  /** 제목 아래(다음 제목 전까지) 문단 글 — 문항을 만든 안내문이 여기에 있다 */
  body: string
}

/** 본문(최상위) 문단만 훑어 제목 구역 목록을 만든다. 파란 글씨 안내문과 표 안의 글은 제목으로 보지 않는다. */
function buildSections(docs: Document[], style: StyleInfo): Section[] {
  const out: Section[] = []
  for (const doc of docs) {
    let cur: Section | null = null
    for (const p of childEls(doc.documentElement, 'p')) {
      const text = ownText(p).trim()
      if (!text) continue
      if (text.length <= 100 && HEADING_RE.test(text) && classifyPara(p, style) === 'content') {
        cur = { doc, p, head: norm(text), body: '' }
        out.push(cur)
      } else if (cur && cur.body.length < 4000) {
        cur.body += norm(text)
      }
    }
  }
  return out
}

/** p 바로 뒤 문단 n개의 글 (정규화) — 이미 넣은 답과 중복인지 볼 때 사용 */
function textAfter(p: Element, n: number): string {
  let out = ''
  let count = 0
  for (let s = p.nextSibling; s && count < n; s = s.nextSibling) {
    if (s.nodeType !== 1 || lname(s) !== 'p') continue
    out += norm(ownText(s as Element))
    count++
  }
  return out
}

/** 문항에서 비교용 단어를 뽑는다 (괄호·"여러 건 입력" 제외, 2자 이상). */
function labelTokens(question: string): string[] {
  const cleaned = question
    .replace(/[(（][^)）]*[)）]/g, ' ')
    .replace(/여러\s*건\s*입력/g, ' ')
    .replace(/[-–—:/·,]/g, ' ')
  return cleaned.split(/\s+/).map(norm).filter((t) => t.length >= 2 && !SECTION_STOPWORDS.has(t))
}

/** 제목 구역 비교에서 빼는 말 — 양식 안내문에 그대로 안 나와도 되는 문항 꼬리말 */
const SECTION_STOPWORDS = new Set(['여부', '또는', '혹은', '사항', '내용', '관련', '및', '등', '시', '경우', '방법', '단계'])

const shortLabel = (question: string) =>
  question.replace(/[(（][^)）]*[)）]/g, '').replace(/\s*[-–—]?\s*여러\s*건\s*입력\s*$/, '').trim()

/** 단어들 중 text 에 들어 있는 것의 글자 수 비율 */
function coverage(tokens: string[], text: string): number {
  const total = tokens.reduce((n, t) => n + t.length, 0)
  if (total === 0) return 0
  return tokens.reduce((n, t) => (text.includes(t) ? n + t.length : n), 0) / total
}

/**
 * 문항이 속한 제목 구역. 문항 단어가 전부(제목 + 아래 안내문) 들어 있어야 하고, 제목에 많이 들어 있을수록 우선한다.
 * 같은 점수의 구역이 둘 이상이면 어느 쪽인지 알 수 없으므로 고르지 않는다.
 */
function pickSection(sections: Section[], question: string, usedP: Set<Element>): Section | null {
  const tokens = labelTokens(question)
  if (tokens.reduce((n, t) => n + t.length, 0) < 4) return null
  let best: Section | null = null
  let bestScore = -1
  let tie = false
  for (const s of sections) {
    if (usedP.has(s.p)) continue
    if (coverage(tokens, s.head + s.body) < 0.999) continue
    const score = coverage(tokens, s.head)
    if (score > bestScore + 1e-9) { best = s; bestScore = score; tie = false }
    else if (Math.abs(score - bestScore) < 1e-9) tie = true
  }
  return best && !tie ? best : null
}

/** 괄호 안내("(*2인 이상인 경우 …)")를 뺀 칸 글 */
const stripParen = (s: string) => s.replace(/[(（][^)）]*[)）]/g, ' ').trim()

/**
 * "그룹 + 하위 라벨" 문항("공동연구자 성명")의 후보 하위 라벨 칸들.
 * 문항 끝이 어떤 칸의 글("성 명")과 같고, 그 앞부분("공동연구자")이 같은 행을 덮는 왼쪽의 가장 가까운 칸 글과 같은 경우.
 */
interface GroupedSlot {
  doc: Document
  tbl: Element
  /** 병합된 그룹 칸 ("공동연구자") */
  g: GridCell
  /** 하위 라벨 칸 ("성 명") */
  s: GridCell
  tc: Element
  p: Element
}

function groupedLabelCandidates(docs: Document[], nq: string): GroupedSlot[] {
  const out: GroupedSlot[] = []
  for (const doc of docs) {
    for (const tbl of descendants(doc.documentElement, 'tbl')) {
      const grid = buildGrid(tbl)
      for (const s of grid.cells) {
        const ns = norm(stripParen(cellText(s.tc)))
        if (ns.length < 2 || nq.length <= ns.length || !nq.endsWith(ns)) continue
        const prefix = nq.slice(0, nq.length - ns.length)
        let g: GridCell | null = null
        for (const c of grid.cells) {
          if (c === s || c.col + c.colSpan > s.col) continue
          if (c.row <= s.row && s.row < c.row + c.rowSpan && (!g || c.col > g.col)) g = c
        }
        if (!g) continue
        const ng = norm(stripParen(cellText(g.tc)))
        if (ng.length < 2 || similarity(ng, prefix) < 0.7) continue
        const p = cellParas(s.tc)[0]
        if (p) out.push({ doc, tbl, g, s, tc: s.tc, p })
      }
    }
  }
  return out
}

/** 여러 건(여러 사람·여러 행)을 한 줄에 " | " 로 이어 준 답을 건 단위 줄로 나눈다 */
function splitBar(lines: string[]): string[] {
  return lines.flatMap((l) => l.split(/\s+\|\s+/)).map((l) => l.trim()).filter(Boolean)
}

/** 셀 높이 (cellSz height) */
function cellHeight(tc: Element): number {
  return intAttr(childEls(tc, 'cellSz')[0], 'height') ?? 0
}

/**
 * 그룹 칸("공동연구자", 세로 병합) 안의 하위 라벨 행 묶음(성 명 / 소 속 / 직 위)을 extra 번 복제해 바로 아래에 붙이고,
 * 그룹 칸의 세로 병합을 그만큼 늘린다. 양식에 적힌 "2인 이상인 경우 칸을 추가하여 작성" 을 코드가 대신 하는 것.
 * 반환: 복제한 묶음마다 "원래 라벨 칸 → 복제한 라벨 칸" 대응. 안전하게 복제할 수 없는 구조면 null.
 */
function expandGroupBlock(tbl: Element, gTc: Element, labelTcs: Element[], extra: number): Array<Map<Element, Element>> | null {
  if (extra <= 0) return []
  const grid = buildGrid(tbl)
  const g = grid.byTc.get(gTc)
  const labels = labelTcs.map((tc) => grid.byTc.get(tc)).filter((c): c is GridCell => !!c)
  if (!g || labels.length === 0) return null

  const start = Math.min(...labels.map((c) => c.row))
  const end = Math.max(...labels.map((c) => c.row + c.rowSpan - 1))
  const blockLen = end - start + 1
  // 묶음이 그룹 칸의 세로 범위 안에 있어야 한다
  if (start < g.row || end > g.row + g.rowSpan - 1) return null

  const trOf = new Map<number, Element>()
  for (const c of grid.cells) {
    if (c.tc === gTc) continue
    const tr = closest(c.tc, 'tr')
    if (tr && c.row >= start && c.row <= end) trOf.set(c.row, tr)
  }
  const rowHeights: number[] = []
  for (let r = start; r <= end; r++) {
    if (!trOf.has(r)) return null // 행 전체가 위쪽 병합에 덮인 경우 등 — 복제하지 않는다
    const hs = grid.cells.filter((c) => c.row === r && c.rowSpan === 1 && c.tc !== gTc).map((c) => cellHeight(c.tc))
    rowHeights.push(Math.max(0, ...hs))
  }

  for (const c of grid.cells) {
    if (c.tc === gTc) continue
    const top = c.row
    const bottom = c.row + c.rowSpan - 1
    const touches = bottom >= start && top <= end
    // 묶음 경계를 넘나드는 병합 칸이 있으면 복제하면 표가 깨진다
    if (touches && (top < start || bottom > end)) return null
    if (top <= end && bottom > end) return null
    if (touches && (descendants(c.tc, 'tbl').length > 0 || descendants(c.tc, 'pic').length > 0)) return null
  }

  const shift = extra * blockLen
  // 뒤쪽 행의 행 번호를 민다 (복제본은 아래에서 직접 번호를 매긴다)
  for (const tc of descendants(tbl, 'tc')) {
    if (closest(tc, 'tbl') !== tbl) continue
    const addr = childEls(tc, 'cellAddr')[0]
    const r = intAttr(addr, 'rowAddr')
    if (addr && r != null && r > end) addr.setAttribute('rowAddr', String(r + shift))
  }

  const maps: Array<Map<Element, Element>> = []
  let anchor = trOf.get(end)!
  for (let k = 1; k <= extra; k++) {
    const map = new Map<Element, Element>()
    for (let r = start; r <= end; r++) {
      const orig = trOf.get(r)!
      const clone = orig.cloneNode(true) as Element
      const origTcs = childEls(orig, 'tc')
      const cloneTcs = childEls(clone, 'tc')
      origTcs.forEach((otc, i) => {
        const ctc = cloneTcs[i]
        if (otc === gTc) { clone.removeChild(ctc); return } // 그룹 칸은 복제하지 않는다 (병합을 늘린다)
        const addr = childEls(ctc, 'cellAddr')[0]
        const rr = intAttr(addr, 'rowAddr')
        if (addr && rr != null) addr.setAttribute('rowAddr', String(rr + k * blockLen))
        for (const p of cellParas(ctc)) dropLineSegs(p)
        map.set(otc, ctc)
      })
      anchor.parentNode!.insertBefore(clone, anchor.nextSibling)
      anchor = clone
    }
    maps.push(map)
  }

  const addedHeight = extra * rowHeights.reduce((a, b) => a + b, 0)
  const span = childEls(gTc, 'cellSpan')[0]
  if (span) span.setAttribute('rowSpan', String(g.rowSpan + shift))
  const gSz = childEls(gTc, 'cellSz')[0]
  if (gSz && addedHeight) gSz.setAttribute('height', String(cellHeight(gTc) + addedHeight))
  const cnt = intAttr(tbl, 'rowCnt')
  if (cnt != null) tbl.setAttribute('rowCnt', String(cnt + shift))
  const tSz = childEls(tbl, 'sz')[0]
  const th = intAttr(tSz, 'height')
  if (tSz && th != null && addedHeight) tSz.setAttribute('height', String(th + addedHeight))
  gridCache.delete(tbl)
  return maps
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
  multi = false,
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
    if (below && below !== 'blocked') {
      // "여러 건 입력" 문항인데 제목 아래가 머리글 없는 빈 칸 여러 개면, 한 건씩 칸을 나눠 넣는다
      if (multi) {
        const start = grid.byTc.get(below.tc)
        const entries = splitEntries(lines)
        if (start && entries.length >= 2 && fillBlankGrid(doc, tbl, start, entries, classify, style)) return true
      }
      return fillCell(doc, below.tc, below.kind, lines, style)
    }
    return false
  }
  fillInline(doc, p, lines)
  return true
}

/** 답변을 건 단위로 나눈다. 한 줄뿐이고 " / " 로 이어져 있으면 그 기준으로 나눈다. */
function splitEntries(lines: string[]): string[] {
  const entries = splitBar(lines)
  if (entries.length === 1 && /\s\/\s/.test(entries[0])) {
    return entries[0].split(/\s+\/\s+/).map((x) => x.trim()).filter(Boolean)
  }
  return entries
}

/**
 * 머리글 없이 빈 칸만 이어진 영역(예: 2칸짜리 자격사항 표)에 한 건당 한 칸씩 읽는 순서대로 넣는다.
 * 칸이 모자라면 마지막 행을 복제해 늘리고, 복제할 수 없으면 남는 건은 마지막 칸에 줄바꿈으로 모은다.
 * 칸이 하나뿐이면 아무것도 하지 않고 false (기존 방식으로 처리).
 */
function fillBlankGrid(
  doc: Document,
  tbl: Element,
  start: GridCell,
  entries: string[],
  classify: Classify,
  style: StyleInfo,
): boolean {
  const grid = buildGrid(tbl)
  const rows: Array<Array<{ tc: Element; kind: CellKind }>> = []
  let lastRow = start.row
  for (let r = start.row; ; r++) {
    const cells = grid.cells.filter((c) => c.row === r).sort((a, b) => a.col - b.col)
    if (cells.length === 0 || cells.some((c) => c.rowSpan > 1)) break
    const kinds = cells.map((c) => classify(c.tc))
    if (kinds.some((k) => k !== 'empty' && k !== 'guide')) break
    rows.push(cells.map((c, i) => ({ tc: c.tc, kind: kinds[i] })))
    lastRow = r
  }
  const slots = rows.flat()
  if (slots.length < 2) return false

  let remaining = entries.length - slots.length
  while (remaining > 0) {
    const lastTr = closest(rows[rows.length - 1][0].tc, 'tr')
    const clone = lastTr ? cloneRowAfter(tbl, lastTr, lastRow) : null
    if (!clone) break
    lastRow++
    const added = childEls(clone, 'tc').map((tc) => ({ tc, kind: 'empty' as CellKind }))
    rows.push(added)
    slots.push(...added)
    remaining -= added.length
  }

  const n = Math.min(entries.length, slots.length)
  for (let i = 0; i < n; i++) {
    const rest = i === slots.length - 1 ? entries.slice(i) : [entries[i]]
    fillCell(doc, slots[i].tc, slots[i].kind, rest, style)
  }
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
  if (kind === 'choices') return fillChoices(doc, paras, lines)

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

/**
 * 선택지 셀("□ 교수  □ 박사과정 대학원생  □ 기타( 예: … )")에 답변과 맞는 항목을 체크(☑)한다.
 *  - 답변이 항목 이름을 포함하거나 같으면 그 항목 ("조교수" → 교수)
 *  - 맞는 항목이 없고 "기타" 가 있으면 기타를 체크하고 괄호 안을 답변으로 바꾼다
 *  - 어느 쪽도 안 되면 아무것도 바꾸지 않고 false (호출부가 문서 끝으로 보낸다)
 */
function fillChoices(doc: Document, paras: Element[], lines: string[]): boolean {
  interface Opt { t: Element; start: number; end: number; label: string }
  const opts: Opt[] = []
  for (const p of paras) {
    for (const t of ownTs(p)) {
      const text = tText(t)
      const re = /[□☐]\s*[^□☐]*/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        opts.push({ t, start: m.index, end: m.index + m[0].length, label: m[0].replace(/^[□☐]\s*/, '').trim() })
      }
    }
  }
  if (opts.length < 2) return false

  const core = (o: Opt) => norm(o.label.replace(/[(（].*$/, ''))
  const isEtc = (o: Opt) => core(o).includes('기타')
  const chosen = new Map<Opt, string | null>() // 체크할 항목 → 기타 괄호에 쓸 답 (그 외는 null)
  for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
    const na = norm(line)
    if (na.length < 2) continue
    let best: Opt | null = null
    for (const o of opts) {
      const c = core(o)
      if (c.length < 2 || isEtc(o)) continue
      if ((na.includes(c) || c.includes(na)) && (!best || c.length > core(best).length)) best = o
    }
    if (best) { chosen.set(best, null); continue }
    const etc = opts.find(isEtc)
    if (!etc) return false
    chosen.set(etc, line)
  }
  if (chosen.size === 0) return false

  const byT = new Map<Element, Opt[]>()
  chosen.forEach((_, o) => byT.set(o.t, [...(byT.get(o.t) ?? []), o]))
  byT.forEach((list, t) => {
    let text = tText(t)
    // 뒤에서부터 바꿔야 앞쪽 위치가 어긋나지 않는다
    for (const o of list.sort((a, b) => b.start - a.start)) {
      let seg = text.slice(o.start, o.end).replace(/[□☐]/, '☑')
      const etcAnswer = chosen.get(o)
      if (etcAnswer) {
        seg = /[(（][^)）]*[)）]/.test(seg)
          ? seg.replace(/[(（][^)）]*[)）]/, `(${etcAnswer})`)
          : seg.replace(/\s*$/, (tail) => `(${etcAnswer})${tail}`)
      }
      text = text.slice(0, o.start) + seg + text.slice(o.end)
    }
    setTText(doc, t, text)
    const p = closest(t, 'p')
    if (p) dropLineSegs(p)
  })
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
    } else {
      // 개수가 안 맞으면 값의 종류(전화번호·이메일)와 라벨 이름이 맞는 경우에만 짝지음. 하나라도 못 정하면 아무것도 쓰지 않는다.
      const typed = assignByValueType(freeSubs, looseLines)
      if (typed) typed.forEach((value, p) => assigned.set(p, value))
    }
  }

  if (assigned.size === 0) return false
  assigned.forEach((value, p) => appendAfterLabel(doc, p, value))
  return true
}

/** 값의 종류별로 어울리는 하위 라벨 (앞쪽 패턴이 더 구체적이라 먼저 시도) */
const TYPED_LABELS: Array<{ isValue: (v: string) => boolean; labels: RegExp[] }> = [
  { isValue: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), labels: [/메일|mail/i] },
  {
    isValue: (v) => /^[\d\s\-+().]{7,}$/.test(v),
    labels: [/휴대|핸드폰|모바일|mobile|cell/i, /전화|tel|phone|연락/i],
  },
]

/** 라벨 없는 줄들을 값의 종류(전화번호·이메일)로 하위 라벨에 배분. 모든 줄을 확실히 짝지을 수 있을 때만 결과를 돌려준다. */
function assignByValueType(free: Element[], lines: string[]): Map<Element, string> | null {
  const out = new Map<Element, string>()
  for (const line of lines) {
    const kind = TYPED_LABELS.find((t) => t.isValue(line))
    if (!kind) return null
    let hit: Element | undefined
    for (const re of kind.labels) {
      hit = free.find((p) => !out.has(p) && re.test(ownText(p).replace(/[:：][\s\S]*$/, '')))
      if (hit) break
    }
    if (!hit) return null
    out.set(hit, line)
  }
  return out
}

const BLANK_TAIL = /(?:[_＿]{2,}|\.{3,}|…+|\(\s{2,}\)|\[\s{2,}\])\s*$/

/** "라벨 : 템플릿" 의 템플릿 부분에 남아 있는 자리표시 ("0000년 00월 00일", "○○○", "____") */
const TEMPLATE_AFTER_COLON = /^([^:：]{1,30}[:：])\s*(.*(?:0{2,}|[○◯]{2,}|[_＿]{2,}|X{2,}).*)$/

function fillInline(doc: Document, p: Element, lines: string[]) {
  const ts = ownTs(p)
  const lastT = ts[ts.length - 1]
  // "3. 연구기간 :  IRB승인후부터 ~ 0000년 00월 00일" → 콜론 뒤 템플릿을 답변으로 바꾼다
  if (ts.length === 1 && lastT) {
    const m = TEMPLATE_AFTER_COLON.exec(tText(lastT).trim())
    if (m) {
      setTText(doc, lastT, `${m[1]} ${lines.map((l) => l.trim()).filter(Boolean).join(' ')}`)
      dropLineSegs(p)
      return
    }
  }
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
