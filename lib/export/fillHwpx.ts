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
  if (DATE_PLACEHOLDER.test(text)) return 'guide'
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

// ── 열 머리글이 있는 "여러 건 입력" 표 ─────────────────────────
interface ColumnSpec {
  title: string
  columns: string[]
}

/** "표 이름 (열1 / 열2 / 열3) - 여러 건 입력" → 표 이름과 열 이름들 */
function parseColumnSpec(question: string): ColumnSpec | null {
  const groups = Array.from(question.matchAll(/[(（]([^()（）]*\/[^()（）]*)[)）]/g))
  if (groups.length === 0) return null
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
function findHeader(tbl: Element, columns: string[]): { row: number; cols: GridCell[] } | null {
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
    if (cols.length === columns.length) return { row, cols }
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
  usedTables: Set<Element>,
): string[] | null {
  let best: { tbl: Element; doc: Document; header: { row: number; cols: GridCell[] }; score: number } | null = null
  const nTitle = norm(spec.title)
  for (const doc of docs) {
    for (const tbl of descendants(doc.documentElement, 'tbl')) {
      if (usedTables.has(tbl)) continue
      const header = findHeader(tbl, spec.columns)
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
  const classify: Classify = (c) => classifyCell(c, isQuestionCell, style)

  // 머리글 아래에서 대상 칸이 모두 비어 있는(또는 안내문뿐인) 연속된 행들. 질문의 열 순서로 보관.
  const rowTargets: Array<Array<{ tc: Element; kind: CellKind }>> = []
  for (let r = headerBottom; r < rowsCount; r++) {
    const targets: Array<{ tc: Element; kind: CellKind }> = []
    for (const hc of header.cols) {
      const cell = grid.at.get(`${r},${hc.col}`)
      if (!cell || cell.row !== r) break
      const kind = classify(cell.tc)
      if (kind !== 'empty' && kind !== 'guide') break
      targets.push({ tc: cell.tc, kind })
    }
    if (targets.length !== header.cols.length) break
    rowTargets.push(targets)
  }
  if (rowTargets.length === 0) return null

  usedTables.add(tbl)
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean)
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
    }
    const values = splitRow(nonEmpty[i], header.cols.length)
    rowTargets[i].forEach((t, k) => {
      if (values[k]) fillCell(doc, t.tc, t.kind, [values[k]], style)
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

  // 열 머리글이 있는 "여러 건 입력" 표 문항: 한 줄 = 한 행, " / " 로 열을 나눠 각 칸에 넣는다
  const sectionDocs = Array.from(docs.values())
  const usedTables = new Set<Element>()
  for (let i = 0; i < work.length; ) {
    const w = work[i]
    const spec = parseColumnSpec(w.question)
    const leftover = spec ? fillColumnTable(sectionDocs, spec, w.lines, isQuestionCell, style, usedTables) : null
    if (leftover === null) { i++; continue }
    work.splice(i, 1)
    filled++
    if (leftover.length > 0) unmatched.push({ question: w.question, lines: leftover })
  }

  const findBest = (w: { nq: string }, threshold: number) => {
    let best = -1
    let bestScore = 0
    for (let j = 0; j < cands.length; j++) {
      if (used.has(j)) continue
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
      last = best
      const c = cands[best]
      if (place(c.doc, c.p, w.lines, isQuestionCell, style)) filled++
      else failed.push(w)
    }
    pending = failed
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
