/**
 * .hwp(바이너리) 양식을 읽어 문단/표 구조를 모델로 뽑고, 같은 구조의 .hwpx 를 새로 만든다.
 *
 *  .hwp  --parseHwpStructure-->  { 문단, 표(행·열·병합·폭) }  --buildHwpx-->  .hwpx
 *
 * 만들어진 .hwpx 는 fillHwpx 가 그대로 읽어서 답변을 채울 수 있다.
 * 글꼴·정렬 같은 세부 서식은 가져오지 않고(기본 서식), 글 내용·표 구조·셀 병합·열 폭을 보존한다.
 * 색은 "파란 글씨 = 작성 예시·안내" 관례 하나만 가져온다 (fillHwpx 가 예시를 지우고 답변으로 덮어쓸 수 있도록).
 * 그림·도형·머리글/바닥글은 가져오지 않는다.
 */
import JSZip from 'jszip'

export interface HwpCell {
  row: number
  col: number
  rowSpan: number
  colSpan: number
  width: number
  height: number
  /** 셀 안의 문단 텍스트들 */
  paras: string[]
  /** paras 와 같은 길이. true 면 그 문단이 전부 파란 글씨(양식의 작성 예시·안내 문구 관례) */
  guide?: boolean[]
}

export type HwpBlock =
  | { kind: 'p'; text: string; guide?: boolean }
  | { kind: 'tbl'; rows: number; cols: number; width: number; cells: HwpCell[] }

export interface HwpStructure {
  blocks: HwpBlock[]
  page: { width: number; height: number; left: number; right: number; top: number; bottom: number; header: number; footer: number }
}

const DEFAULT_PAGE = { width: 59528, height: 84186, left: 8504, right: 8504, top: 5668, bottom: 4252, header: 4252, footer: 4252 }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

function ctrlTag(id: number): string {
  return String.fromCharCode((id >>> 24) & 255, (id >>> 16) & 255, (id >>> 8) & 255, id & 255)
}

/* eslint-disable-next-line no-control-regex */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g

function paraText(p: Any): string {
  let s = ''
  for (const c of p.chars) s += c.toString()
  return s.replace(CONTROL_CHARS, '').replace(/\r/g, '')
}

/** 파란 계열 글자색인가 (fillHwpx 의 안내문 판별과 같은 기준) */
function isBlueColor(c: Any): boolean {
  return !!c && c.blue >= 150 && c.red <= 100 && c.green <= 140
}

/**
 * 문단의 글자가 전부 파란색인가. 문단의 charShapes(시작 위치 → 글자 모양)와
 * DocInfo 의 글자 모양 색을 대조한다. 글자가 하나도 없으면 false.
 */
function paraIsBlue(p: Any, shapes: Any[]): boolean {
  if (!shapes.length) return false
  const runs = (Array.from((p.charShapes ?? []) as Any[]) as Any[])
    .map((r) => ({ start: Number(r.startPosition ?? 0), id: Number(r.shapeId) }))
    .sort((a, b) => a.start - b.start)
  if (runs.length === 0) return false
  const chars = Array.from(p.chars as Any[]).map((c) => String(c.toString()))
  let any = false
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i].replace(CONTROL_CHARS, '')
    if (!ch.trim()) continue
    let id = runs[0].id
    for (const r of runs) if (r.start <= i) id = r.id
    if (!isBlueColor(shapes[id]?.color)) return false
    any = true
  }
  return any
}

export async function parseHwpStructure(buffer: Buffer): Promise<HwpStructure> {
  const { parse, TableControl } = (await import('@hwp.js/parser')) as Any
  const doc = parse(buffer)
  const page = { ...DEFAULT_PAGE }
  const blocks: HwpBlock[] = []
  const shapes: Any[] = doc.info?.idMappings?.charShapes ?? []

  const readTable = (t: Any): HwpBlock => {
    const cells: HwpCell[] = []
    for (const cell of t.cells) {
      const cps = Array.from(cell.paragraphs as Any[])
      cells.push({
        row: cell.row,
        col: cell.column,
        rowSpan: Math.max(1, cell.rowSpan ?? 1),
        colSpan: Math.max(1, cell.colSpan ?? 1),
        width: cell.width,
        height: cell.height,
        paras: cps.map(paraText),
        guide: cps.map((cp) => paraIsBlue(cp, shapes)),
      })
    }
    return {
      kind: 'tbl',
      rows: t.record?.rows ?? Math.max(0, ...cells.map((c) => c.row + c.rowSpan)),
      cols: t.record?.cols ?? Math.max(0, ...cells.map((c) => c.col + c.colSpan)),
      width: t.commonProperties?.width ?? cells.reduce((m, c) => Math.max(m, c.width), 0),
      cells,
    }
  }

  let firstSection = true
  for (const sec of doc.sections as Any[]) {
    for (const p of Array.from(sec.paragraphs as Any[])) {
      const text = paraText(p)
      const tables: HwpBlock[] = []
      for (const ctrl of (p.controls ?? []) as Any[]) {
        const tag = ctrlTag(ctrl.id)
        // 표 컨트롤은 { id, content: TableControl } 로 한 겹 싸여 있다
        const inner = ctrl.content
        if (inner instanceof TableControl || tag === 'tbl ') {
          if (inner?.cells) tables.push(readTable(inner))
        } else if (tag === 'secd' && firstSection && inner?.pageDefinition) {
          const d = inner.pageDefinition
          page.width = d.width
          page.height = d.height
          page.left = d.padding.left
          page.right = d.padding.right
          page.top = d.padding.top
          page.bottom = d.padding.bottom
          page.header = d.padding.header
          page.footer = d.padding.footer
          firstSection = false
        }
      }
      if (text.trim() || tables.length === 0) blocks.push({ kind: 'p', text, guide: paraIsBlue(p, shapes) })
      blocks.push(...tables)
    }
  }
  return { blocks, page }
}

/** 문항 추출용 텍스트에서 작성 예시(파란 글씨)를 표시하는 접두어 */
export const EXAMPLE_MARK = '〔예시〕'

/**
 * 문항 추출용 텍스트. 표는 행마다 한 줄로, 셀은 " | " 로 이어 열 머리글(구분 | 내역 | 예산액 …)이 보이게 한다.
 * 파란 글씨(작성 예시·안내)는 〔예시〕 로 표시해 AI 가 문항으로 오인하지 않게 한다.
 */
export function structureToText(structure: HwpStructure): string {
  const lines: string[] = []
  for (const b of structure.blocks) {
    if (b.kind === 'p') {
      if (b.text.trim()) lines.push(b.guide ? `${EXAMPLE_MARK} ${b.text.trim()}` : b.text.trim())
      continue
    }
    const rows = new Map<number, HwpCell[]>()
    for (const c of b.cells) {
      if (!rows.has(c.row)) rows.set(c.row, [])
      rows.get(c.row)!.push(c)
    }
    for (const r of Array.from(rows.keys()).sort((a, b2) => a - b2)) {
      const line = rows
        .get(r)!
        .sort((a, b2) => a.col - b2.col)
        .map((c) =>
          c.paras
            .map((x, i) => (c.guide?.[i] && x.trim() ? `${EXAMPLE_MARK} ${x.trim()}` : x.trim()))
            .filter(Boolean)
            .join(' '),
        )
        .join(' | ')
      if (line.replace(/[|\s]/g, '')) lines.push(line)
    }
  }
  return lines.join('\n').trim()
}

// ── HWPX 생성 ─────────────────────────────────────────────────
const NS =
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" ' +
  'xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" ' +
  'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" ' +
  'xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" ' +
  'xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
  'xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" ' +
  'xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" ' +
  'xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"'
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fontfaces(): string {
  const langs = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER']
  const font =
    '<hh:font id="0" face="함초롬바탕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>'
  return `<hh:fontfaces itemCnt="7">${langs
    .map((l) => `<hh:fontface lang="${l}" fontCnt="1">${font}</hh:fontface>`)
    .join('')}</hh:fontfaces>`
}

function borderFill(id: number, line: boolean): string {
  const side = (n: string) =>
    `<hh:${n} type="${line ? 'SOLID' : 'NONE'}" width="${line ? '0.12 mm' : '0.1 mm'}" color="#000000"/>`
  return (
    `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
    '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' +
    side('leftBorder') + side('rightBorder') + side('topBorder') + side('bottomBorder') +
    '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/></hh:borderFill>'
  )
}

function paraPr(id: number, align: string, spacing: number): string {
  const margin =
    '<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>' +
    `<hh:lineSpacing type="PERCENT" value="${spacing}" unit="HWPUNIT"/>`
  return (
    `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">` +
    `<hh:align horizontal="${align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>` +
    '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>' +
    '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>' +
    `<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin}</hp:case><hp:default>${margin}</hp:default></hp:switch>` +
    '<hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>'
  )
}

/** 작성 예시(안내) 문단에 쓰는 글자 스타일. 파란색 — fillHwpx 가 안내문으로 보고 덮어쓴다. */
const GUIDE_CHARPR_ID = 2
const GUIDE_COLOR = '#2E74B5'

function charPr(id: number, bold: boolean, color = '#000000'): string {
  const all = (tag: string, v: number) =>
    `<hh:${tag} hangul="${v}" latin="${v}" hanja="${v}" japanese="${v}" other="${v}" symbol="${v}" user="${v}"/>`
  return (
    `<hh:charPr id="${id}" height="1000" textColor="${color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">` +
    all('fontRef', 0) + all('ratio', 100) + all('spacing', 0) + all('relSz', 100) + all('offset', 0) +
    (bold ? '<hh:bold/>' : '') +
    '<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/>' +
    '<hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>'
  )
}

function headerXml(): string {
  return (
    DECL +
    `<hh:head ${NS} version="1.5" secCnt="1">` +
    '<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>' +
    '<hh:refList>' +
    fontfaces() +
    `<hh:borderFills itemCnt="3">${borderFill(1, false)}${borderFill(2, false)}${borderFill(3, true)}</hh:borderFills>` +
    `<hh:charProperties itemCnt="3">${charPr(0, false)}${charPr(1, true)}${charPr(GUIDE_CHARPR_ID, false, GUIDE_COLOR)}</hh:charProperties>` +
    '<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>' +
    `<hh:paraProperties itemCnt="2">${paraPr(0, 'LEFT', 160)}${paraPr(1, 'LEFT', 130)}</hh:paraProperties>` +
    '<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles>' +
    '</hh:refList>' +
    '<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>' +
    '<hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption>' +
    '<hh:trackchageConfig flags="56"/></hh:head>'
  )
}

function secPr(page: HwpStructure['page']): string {
  const note =
    '<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>'
  const pbf = (type: string) =>
    `<hp:pageBorderFill type="${type}" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>`
  return (
    '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="0" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">' +
    '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>' +
    '<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>' +
    '<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>' +
    `<hp:pagePr landscape="WIDELY" width="${page.width}" height="${page.height}" gutterType="LEFT_ONLY">` +
    `<hp:margin header="${page.header}" footer="${page.footer}" gutter="0" left="${page.left}" right="${page.right}" top="${page.top}" bottom="${page.bottom}"/></hp:pagePr>` +
    `<hp:footNotePr>${note}<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>` +
    `<hp:endNotePr>${note}<hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>` +
    pbf('BOTH') + pbf('EVEN') + pbf('ODD') +
    '</hp:secPr>'
  )
}

const para = (text: string, paraPrId: number, inner = '', charPrId = 0) =>
  `<hp:p id="0" paraPrIDRef="${paraPrId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
  `<hp:run charPrIDRef="${charPrId}">${inner}${text ? `<hp:t>${esc(text)}</hp:t>` : ''}</hp:run></hp:p>`

function tableXml(t: Extract<HwpBlock, { kind: 'tbl' }>, id: number, textWidth: number): string {
  const scale = t.width > textWidth ? textWidth / t.width : 1
  const w = (v: number) => Math.max(1, Math.round(v * scale))
  const rows = new Map<number, HwpCell[]>()
  for (const c of t.cells) {
    if (!rows.has(c.row)) rows.set(c.row, [])
    rows.get(c.row)!.push(c)
  }
  // 행 높이: 그 행에서 시작하는 셀 중 병합 없는 셀의 높이
  const rowHeight = (r: number) =>
    Math.max(1000, ...((rows.get(r) ?? []).filter((c) => c.rowSpan === 1).map((c) => c.height)))
  const totalHeight = Array.from({ length: t.rows }, (_, r) => rowHeight(r)).reduce((a, b) => a + b, 0)

  const trs = Array.from(rows.keys())
    .sort((a, b) => a - b)
    .map((r) => {
      const tcs = rows
        .get(r)!
        .sort((a, b) => a.col - b.col)
        .map((c) => {
          const paras = (c.paras.length ? c.paras : [''])
            .map((x, i) => para(x, 1, '', c.guide?.[i] && x.trim() ? GUIDE_CHARPR_ID : 0))
            .join('')
          return (
            '<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="3">' +
            `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${paras}</hp:subList>` +
            `<hp:cellAddr colAddr="${c.col}" rowAddr="${c.row}"/><hp:cellSpan colSpan="${c.colSpan}" rowSpan="${c.rowSpan}"/>` +
            `<hp:cellSz width="${w(c.width)}" height="${c.rowSpan === 1 ? c.height : rowHeight(c.row)}"/>` +
            '<hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>'
          )
        })
        .join('')
      return `<hp:tr>${tcs}</hp:tr>`
    })
    .join('')

  return (
    `<hp:tbl id="${id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="${t.rows}" colCnt="${t.cols}" cellSpacing="0" borderFillIDRef="3" noAdjust="0">` +
    `<hp:sz width="${w(t.width)}" widthRelTo="ABSOLUTE" height="${totalHeight}" heightRelTo="ABSOLUTE" protect="0"/>` +
    '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
    '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>' +
    `${trs}</hp:tbl>`
  )
}

export async function buildHwpx(structure: HwpStructure): Promise<Buffer> {
  const { blocks, page } = structure
  const textWidth = page.width - page.left - page.right

  let tblId = 1000000001
  const body = blocks
    .map((b) =>
      b.kind === 'p'
        ? para(b.text, 0, '', b.guide && b.text.trim() ? GUIDE_CHARPR_ID : 0)
        : para('', 0, tableXml(b, tblId++, textWidth)),
    )
  // 첫 문단 첫 run 에 구역 속성(secPr)이 있어야 한다
  const first = body.length ? body[0] : para('', 0)
  const withSec = first.replace(/<hp:run charPrIDRef="(\d+)">/, `<hp:run charPrIDRef="$1">${secPr(page)}`)
  const section = `${DECL}<hs:sec ${NS}>${[withSec, ...body.slice(1)].join('')}</hs:sec>`

  const preview = blocks
    .flatMap((b) => (b.kind === 'p' ? [b.text] : b.cells.flatMap((c) => c.paras)))
    .filter((s) => s.trim())
    .join('\n')

  const zip = new JSZip()
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' })
  zip.file(
    'version.xml',
    `${DECL}<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.5" application="Hancom Office Hangul" appVersion="12, 0, 0, 535 WIN32LEWindows_10"/>`,
  )
  zip.file(
    'settings.xml',
    `${DECL}<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`,
  )
  zip.file(
    'META-INF/container.xml',
    `${DECL}<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/></ocf:rootfiles></ocf:container>`,
  )
  zip.file(
    'META-INF/manifest.xml',
    `${DECL}<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`,
  )
  zip.file(
    'Contents/content.hpf',
    `${DECL}<opf:package ${NS} version="" unique-identifier="" id=""><opf:metadata><opf:title>IRB 양식</opf:title><opf:language>ko</opf:language></opf:metadata>` +
      '<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest>' +
      '<opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>',
  )
  zip.file('Contents/header.xml', headerXml())
  zip.file('Contents/section0.xml', section)
  zip.file('Preview/PrvText.txt', preview)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/** .hwp 파일 → 같은 구조의 .hwpx */
export async function hwpToHwpx(hwp: Buffer): Promise<{ hwpx: Buffer; structure: HwpStructure }> {
  const structure = await parseHwpStructure(hwp)
  return { hwpx: await buildHwpx(structure), structure }
}
