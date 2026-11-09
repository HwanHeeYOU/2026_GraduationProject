/**
 * .hwpx 양식 → 문항 추출용 텍스트.
 *
 * 글 순서를 지키면서 표는 행마다 한 줄로(셀은 " | "), 파란 글씨(작성 예시·안내)는 〔예시〕 로 표시한다.
 * structureToText(.hwp 쪽)와 같은 모양이라 AI 가 두 형식을 똑같이 읽는다.
 */
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { EXAMPLE_MARK } from './hwpToHwpx'

const lname = (n: Node): string => ((n as Element).localName ?? n.nodeName.split(':').pop() ?? '').toLowerCase()

function childEls(el: Element, name: string): Element[] {
  const out: Element[] = []
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && lname(c) === name) out.push(c as Element)
  return out
}

function descendants(el: Element, name: string): Element[] {
  const out: Element[] = []
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue
      if (lname(c) === name) out.push(c as Element)
      walk(c)
    }
  }
  walk(el)
  return out
}

/** header.xml 에서 파란 계열 글자 스타일 id 집합 */
function blueCharPrIds(headerXml: string | null): Set<string> {
  const ids = new Set<string>()
  if (!headerXml) return ids
  const doc = new DOMParser({ errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} } })
    .parseFromString(headerXml, 'text/xml')
  for (const pr of descendants(doc.documentElement, 'charpr')) {
    const m = /^#?([0-9a-f]{6})$/i.exec(pr.getAttribute('textColor') ?? '')
    if (!m) continue
    const n = parseInt(m[1], 16)
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    if (b >= 150 && r <= 100 && g <= 140) ids.add(pr.getAttribute('id') ?? '')
  }
  return ids
}

/** 문단 자신의 글(표 안의 글 제외)과, 글자가 전부 파란색인지 */
function paraInfo(p: Element, blue: Set<string>): { text: string; guide: boolean } {
  let text = ''
  let anyText = false
  let allBlue = true
  for (const run of childEls(p, 'run')) {
    let t = ''
    for (const tEl of childEls(run, 't')) t += tEl.textContent ?? ''
    if (!t.trim()) { text += t; continue }
    text += t
    anyText = true
    if (!blue.has(run.getAttribute('charPrIDRef') ?? '')) allBlue = false
  }
  return { text: text.trim(), guide: anyText && allBlue }
}

function cellText(tc: Element, blue: Set<string>): string {
  const parts: string[] = []
  for (const sub of childEls(tc, 'sublist')) {
    for (const p of childEls(sub, 'p')) {
      const { text, guide } = paraInfo(p, blue)
      if (text) parts.push(guide ? `${EXAMPLE_MARK} ${text}` : text)
      // 셀 안의 중첩 표는 글만 이어 붙인다
      for (const run of childEls(p, 'run')) {
        for (const t of childEls(run, 'tbl')) {
          const inner = descendants(t, 't').map((x) => (x.textContent ?? '').trim()).filter(Boolean).join(' ')
          if (inner) parts.push(inner)
        }
      }
    }
  }
  return parts.join(' ')
}

function emitPara(p: Element, blue: Set<string>, lines: string[]) {
  const { text, guide } = paraInfo(p, blue)
  if (text) lines.push(guide ? `${EXAMPLE_MARK} ${text}` : text)
  for (const run of childEls(p, 'run')) {
    for (const tbl of childEls(run, 'tbl')) {
      for (const tr of childEls(tbl, 'tr')) {
        const line = childEls(tr, 'tc').map((tc) => cellText(tc, blue)).join(' | ')
        if (line.replace(/[|\s]/g, '')) lines.push(line)
      }
    }
  }
}

export async function hwpxToText(buffer: Buffer): Promise<string | null> {
  const zip = await JSZip.loadAsync(buffer)
  const names = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)?.[1]) - Number(b.match(/(\d+)/)?.[1]))
  if (names.length === 0) return null

  const headerName = Object.keys(zip.files).find((n) => /^Contents\/header\.xml$/i.test(n))
  const blue = blueCharPrIds(headerName ? await zip.files[headerName].async('text') : null)

  const parser = new DOMParser({ errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} } })
  const lines: string[] = []
  for (const name of names) {
    const doc = parser.parseFromString(await zip.files[name].async('text'), 'text/xml')
    for (const p of childEls(doc.documentElement, 'p')) emitPara(p, blue, lines)
  }
  return lines.join('\n').trim() || null
}
