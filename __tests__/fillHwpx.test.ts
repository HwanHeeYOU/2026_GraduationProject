// @vitest-environment node
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { fillHwpx } from '@/lib/export/fillHwpx'

const NS =
  'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"'

const para = (text: string, extra = '') =>
  `<hp:p id="0" paraPrIDRef="1" styleIDRef="0"><hp:run charPrIDRef="7">${
    text ? `<hp:t>${text}</hp:t>` : ''
  }</hp:run>${extra}<hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>`

const cell = (col: number, row: number, text: string) =>
  `<hp:tc><hp:subList>${para(text)}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/></hp:tc>`

const tr = (...cells: string[]) => `<hp:tr>${cells.join('')}</hp:tr>`
const tbl = (...rows: string[]) =>
  `<hp:p id="0" paraPrIDRef="1" styleIDRef="0"><hp:run charPrIDRef="0"><hp:tbl>${rows.join('')}</hp:tbl></hp:run></hp:p>`

async function makeHwpx(body: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' })
  zip.file('Contents/header.xml', '<hh:head xmlns:hh="x"/>')
  zip.file(
    'Contents/section0.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec ${NS}>${body}</hs:sec>`
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function readSection(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf)
  const xml = await zip.files['Contents/section0.xml'].async('text')
  const doc = new DOMParser().parseFromString(xml, 'text/xml') // 유효한 XML인지 확인
  const texts = Array.from(doc.getElementsByTagName('hp:t')).map((t) => t.textContent ?? '')
  return { zip, xml, texts }
}

describe('fillHwpx', () => {
  it('문항 셀의 오른쪽 빈 셀에 답변을 넣는다', async () => {
    const tpl = await makeHwpx(
      tbl(tr(cell(0, 0, '연구 제목'), cell(1, 0, '')), tr(cell(0, 1, '연구 기간'), cell(1, 1, '')))
    )
    const r = await fillHwpx(tpl, [
      { question: '연구 제목', answer: '당뇨 환자의 AI 진단 연구' },
      { question: '연구 기간', answer: '2026.03 ~ 2027.02' },
    ])
    const { texts } = await readSection(r.buffer)
    expect(texts).toEqual(['연구 제목', '당뇨 환자의 AI 진단 연구', '연구 기간', '2026.03 ~ 2027.02'])
    expect(r.filled).toBe(2)
    expect(r.unmatched).toEqual([])
  })

  it('머리글 행이면 오른쪽이 아니라 아래 셀에 넣는다', async () => {
    const tpl = await makeHwpx(
      tbl(tr(cell(0, 0, '성명'), cell(1, 0, '소속')), tr(cell(0, 1, ''), cell(1, 1, '')))
    )
    const r = await fillHwpx(tpl, [
      { question: '성명', answer: '홍길동' },
      { question: '소속', answer: '의과대학' },
    ])
    const { texts } = await readSection(r.buffer)
    expect(texts).toEqual(['성명', '소속', '홍길동', '의과대학'])
  })

  it('표 밖 "라벨:" 문단은 같은 줄 뒤에 붙인다', async () => {
    const tpl = await makeHwpx(para('연구 책임자:'))
    const r = await fillHwpx(tpl, [{ question: '연구 책임자', answer: '김교수' }])
    const { texts } = await readSection(r.buffer)
    expect(texts).toEqual(['연구 책임자: 김교수'])
  })

  it('여러 줄 답변은 문단을 추가하고 서식(charPr)을 유지한다', async () => {
    const tpl = await makeHwpx(tbl(tr(cell(0, 0, '연구 목적'), cell(1, 0, ''))))
    const r = await fillHwpx(tpl, [{ question: '연구 목적', answer: '첫째 줄\n둘째 줄\n셋째 줄' }])
    const { texts, xml } = await readSection(r.buffer)
    expect(texts).toEqual(['연구 목적', '첫째 줄', '둘째 줄', '셋째 줄'])
    expect((xml.match(/charPrIDRef="7"/g) ?? []).length).toBeGreaterThanOrEqual(4)
    expect(xml).not.toContain('<hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray><hp:linesegarray>')
  })

  it('"작성 필요" 항목은 비워 두고, 못 찾은 문항은 문서 끝에 모은다', async () => {
    const tpl = await makeHwpx(
      para('머리말') + tbl(tr(cell(0, 0, '연구 제목'), cell(1, 0, '')), tr(cell(0, 1, '예상 위험'), cell(1, 1, '')))
    )
    const r = await fillHwpx(tpl, [
      { question: '연구 제목', answer: '제목입니다' },
      { question: '예상 위험', answer: '[작성 필요: 추가 정보 입력 요망]' },
      { question: '완전히 다른 항목 XYZ', answer: '남는 답변' },
    ])
    const { texts } = await readSection(r.buffer)
    expect(r.skippedMissing).toEqual(['예상 위험'])
    expect(r.unmatched).toEqual(['완전히 다른 항목 XYZ'])
    expect(texts).toContain('제목입니다')
    expect(texts.slice(-3)).toEqual(['※ 양식에서 위치를 찾지 못한 항목', '[문항] 완전히 다른 항목 XYZ', '남는 답변'])
    expect(texts.join('')).not.toContain('작성 필요')
  })

  it('다른 파일과 mimetype(무압축)은 그대로 보존한다', async () => {
    const tpl = await makeHwpx(para('연구 책임자:'))
    const r = await fillHwpx(tpl, [{ question: '연구 책임자', answer: 'A' }])
    const { zip } = await readSection(r.buffer)
    expect(await zip.files['mimetype'].async('string')).toBe('application/hwp+zip')
    expect(await zip.files['Contents/header.xml'].async('string')).toBe('<hh:head xmlns:hh="x"/>')
    expect(Object.keys(zip.files)[0]).toBe('mimetype')
  })

  it('HWPX가 아니면 에러를 던진다', async () => {
    const zip = new JSZip()
    zip.file('a.txt', 'x')
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    await expect(fillHwpx(buf, [])).rejects.toThrow('section')
  })
})
