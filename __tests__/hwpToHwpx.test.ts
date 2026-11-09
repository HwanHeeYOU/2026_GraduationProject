// @vitest-environment node
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { buildHwpx, structureToText, type HwpStructure, type HwpCell } from '@/lib/hwp/hwpToHwpx'
import { fillHwpx } from '@/lib/export/fillHwpx'

const page = { width: 59528, height: 84186, left: 8504, right: 8504, top: 5668, bottom: 4252, header: 4252, footer: 4252 }
const cell = (row: number, col: number, text: string[], o: Partial<HwpCell> = {}): HwpCell => ({
  row, col, rowSpan: 1, colSpan: 1, width: 10000, height: 2000, paras: text, ...o,
})

const structure: HwpStructure = {
  page,
  blocks: [
    { kind: 'p', text: '연구 계획서' },
    { kind: 'p', text: '1. 연구책임자' },
    {
      kind: 'tbl', rows: 3, cols: 2, width: 20000,
      cells: [
        cell(0, 0, ['1. 기본정보'], { colSpan: 2, width: 20000 }),
        cell(1, 0, ['성명']), cell(1, 1, ['']),
        cell(2, 0, ['소속']), cell(2, 1, ['*소속 대학 및 학과 기술']),
      ],
    },
    {
      kind: 'tbl', rows: 3, cols: 4, width: 40000,
      cells: [
        ...['구분', '내역', '예산액', '비고'].map((t, c) => cell(0, c, [t])),
        ...[1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => cell(r, c, [''] ))),
      ],
    },
  ],
}

describe('hwpToHwpx', () => {
  it('구조를 담은 유효한 HWPX 를 만든다', async () => {
    const buf = await buildHwpx(structure)
    const zip = await JSZip.loadAsync(buf)
    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining(['mimetype', 'Contents/header.xml', 'Contents/section0.xml', 'Contents/content.hpf', 'META-INF/container.xml']),
    )
    for (const n of ['Contents/header.xml', 'Contents/section0.xml', 'Contents/content.hpf']) {
      const errs: string[] = []
      new DOMParser({ errorHandler: { warning: () => {}, error: (e: string) => errs.push(e), fatalError: (e: string) => errs.push(e) } })
        .parseFromString(await zip.files[n].async('text'), 'text/xml')
      expect(errs).toEqual([])
    }
    const xml = await zip.files['Contents/section0.xml'].async('text')
    expect(xml).toContain('rowCnt="3" colCnt="4"')
    expect(xml).toContain('colSpan="2"')
    expect(xml.indexOf('<hp:secPr')).toBeGreaterThan(-1)
  })

  it('변환한 HWPX 에 fillHwpx 로 단일 칸과 열 머리글 표를 모두 채운다', async () => {
    const buf = await buildHwpx(structure)
    const r = await fillHwpx(buf, [
      { question: '성명', answer: '홍길동' },
      { question: '소속', answer: '한양대학교 의과대학' },
      { question: '연구비 예산 (구분 / 내역 / 예산액 / 비고) - 여러 건 입력', answer: '인건비 / 연구보조원 / 3,000,000원 / 6개월\n재료비 / 설문 인쇄 / 500,000원 / -' },
    ])
    expect(r.unmatched).toEqual([])
    expect(r.filled).toBe(3)
    const xml = await (await JSZip.loadAsync(r.buffer)).files['Contents/section0.xml'].async('text')
    const texts = Array.from(new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('hp:t')).map((t) => t.textContent)
    expect(texts).toEqual(expect.arrayContaining(['홍길동', '한양대학교 의과대학', '인건비', '연구보조원', '3,000,000원', '6개월', '재료비', '설문 인쇄', '500,000원', '-']))
    expect(texts).not.toContain('*소속 대학 및 학과 기술')
  })

  // 지출내역 서식: 1열에 행 번호, 파란 글씨 작성 예시, 마지막에 합계 줄
  const budget: HwpStructure = {
    page,
    blocks: [
      { kind: 'p', text: '2. 지출내역        (단위 : 원)' },
      {
        kind: 'tbl', rows: 5, cols: 4, width: 40000,
        cells: [
          ...['구분', '내역', '예산액', '비고'].map((t, c) => cell(0, c, [t])),
          cell(1, 0, ['1']), cell(1, 1, ['사례비, 재료비 등 기재'], { guide: [true] }), cell(1, 2, ['']), cell(1, 3, ['세부내역 기재'], { guide: [true] }),
          ...[2, 3].flatMap((r) => [cell(r, 0, [String(r)]), cell(r, 1, ['']), cell(r, 2, ['']), cell(r, 3, [''])]),
          cell(4, 0, ['총 계']), cell(4, 1, ['0']), cell(4, 2, ['']), cell(4, 3, ['']),
        ],
      },
    ],
  }

  it('파란 글씨 예시는 〔예시〕 로 표시해 문항 추출용 텍스트에 넣는다', () => {
    const text = structureToText(budget)
    expect(text).toContain('1 | 〔예시〕 사례비, 재료비 등 기재 |  | 〔예시〕 세부내역 기재')
    expect(text).toContain('구분 | 내역 | 예산액 | 비고')
  })

  it('파란 글씨 예시와 행 번호가 있는 지출 표도 행 단위로 채우고 예시는 지운다', async () => {
    const buf = await buildHwpx(budget)
    const r = await fillHwpx(buf, [
      { question: '지출내역 (구분 / 내역 / 예산액 / 비고) - 여러 건 입력', answer: '인건비 / 연구보조원 2명 / 24,000,000 / 12개월\n재료비 / 검사 시약 / 5,000,000 / -\n회의비 / 자문회의 / 1,000,000 / 2회' },
    ])
    expect(r.unmatched).toEqual([])
    const xml = await (await JSZip.loadAsync(r.buffer)).files['Contents/section0.xml'].async('text')
    const texts = Array.from(new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('hp:t')).map((t) => t.textContent)
    // 번호 열("구분")의 번호는 그대로 두고, 이 열에 온 값은 다음 열 앞에 붙는다
    expect(texts).toEqual([
      '2. 지출내역        (단위 : 원)',
      '구분', '내역', '예산액', '비고',
      '1', '인건비 연구보조원 2명', '24,000,000', '12개월',
      '2', '재료비 검사 시약', '5,000,000', '-',
      '3', '회의비 자문회의', '1,000,000', '2회',
      '총 계', '0',
    ])
  })

  it('번호 열을 뺀 열 목록이면 번호는 그대로 두고 나머지 열만 채운다', async () => {
    const buf = await buildHwpx(budget)
    const r = await fillHwpx(buf, [
      { question: '지출내역 (내역 / 예산액 / 비고) - 여러 건 입력', answer: '인건비 / 24,000,000 / 12개월\n재료비 / 5,000,000 /' },
    ])
    expect(r.unmatched).toEqual([])
    const xml = await (await JSZip.loadAsync(r.buffer)).files['Contents/section0.xml'].async('text')
    const texts = Array.from(new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('hp:t'))
      .map((t) => t.textContent).filter((t) => t && t.trim())
    expect(texts).toEqual([
      '2. 지출내역        (단위 : 원)',
      '구분', '내역', '예산액', '비고',
      '1', '인건비', '24,000,000', '12개월',
      '2', '재료비', '5,000,000',
      '3',
      '총 계', '0',
    ])
  })

  it('행을 복제해 늘릴 때 번호를 앞 행에 이어서 매긴다', async () => {
    const buf = await buildHwpx(budget)
    const r = await fillHwpx(buf, [
      { question: '지출내역 (내역 / 예산액 / 비고) - 여러 건 입력', answer: 'A / 1 /\nB / 2 /\nC / 3 /\nD / 4 /' },
    ])
    expect(r.unmatched).toEqual([])
    const xml = await (await JSZip.loadAsync(r.buffer)).files['Contents/section0.xml'].async('text')
    const texts = Array.from(new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('hp:t'))
      .map((t) => t.textContent).filter((t) => t && t.trim())
    expect(texts.slice(5)).toEqual(['1', 'A', '1', '2', 'B', '2', '3', 'C', '3', '4', 'D', '4', '총 계', '0'])
  })

  it('값이 비어 있는 칸의 파란 예시는 지우고 행 번호는 남긴다', async () => {
    const buf = await buildHwpx(budget)
    const r = await fillHwpx(buf, [
      { question: '지출내역 (구분 / 내역 / 예산액 / 비고) - 여러 건 입력', answer: '인건비 / 연구보조원 / 24,000,000 /' },
    ])
    const xml = await (await JSZip.loadAsync(r.buffer)).files['Contents/section0.xml'].async('text')
    const texts = Array.from(new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('hp:t'))
      .map((t) => t.textContent).filter((t) => t && t.trim())
    expect(texts).not.toContain('세부내역 기재')
    expect(texts).not.toContain('사례비, 재료비 등 기재')
    expect(texts).toEqual(expect.arrayContaining(['인건비 연구보조원', '24,000,000', '1', '2', '3']))
    // 덮어쓴 칸은 파란색(charPr 2)이 아니라 검은색(charPr 0)으로 바뀐다
    expect(xml).not.toMatch(/charPrIDRef="2"><hp:t>/)
  })

  it('문항 추출용 텍스트에 표 안의 글이 행 단위로 들어간다', () => {
    const text = structureToText(structure)
    expect(text).toContain('성명')
    expect(text).toContain('구분 | 내역 | 예산액 | 비고')
  })
})
