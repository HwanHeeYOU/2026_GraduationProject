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

  it('문항 추출용 텍스트에 표 안의 글이 행 단위로 들어간다', () => {
    const text = structureToText(structure)
    expect(text).toContain('성명')
    expect(text).toContain('구분 | 내역 | 예산액 | 비고')
  })
})
