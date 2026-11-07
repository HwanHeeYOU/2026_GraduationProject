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

async function makeHwpx(body: string, header = '<hh:head xmlns:hh="x"/>'): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' })
  zip.file('Contents/header.xml', header)
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

  // cellAddr 없이 cellSpan만 있는 셀 (위치는 병합을 따라 계산해야 함)
  const spanCell = (text: string, colSpan = 1, rowSpan = 1) =>
    `<hp:tc><hp:subList>${para(text)}</hp:subList><hp:cellSpan colSpan="${colSpan}" rowSpan="${rowSpan}"/></hp:tc>`

  it('좌측 큰 병합 셀 + 우측 분할 셀 구조에서 라벨 옆 빈 칸에 넣는다', async () => {
    const tpl = await makeHwpx(
      tbl(
        tr(spanCell('연구자 인적사항', 1, 3), spanCell('소속'), spanCell('')),
        tr(spanCell('직위'), spanCell('')),
        tr(spanCell('성명'), spanCell('')),
      )
    )
    const r = await fillHwpx(tpl, [
      { question: '소속', answer: '의과대학' },
      { question: '직위', answer: '교수' },
      { question: '성명', answer: '홍길동' },
    ])
    const { texts } = await readSection(r.buffer)
    expect(texts).toEqual(['연구자 인적사항', '소속', '의과대학', '직위', '교수', '성명', '홍길동'])
    expect(r.unmatched).toEqual([])
  })

  it('병합 셀이 있는 머리글 행에서 아래 칸을 열 위치 기준으로 찾는다', async () => {
    const tpl = await makeHwpx(
      tbl(
        tr(spanCell('구분', 1, 2), spanCell('성명'), spanCell('소속')),
        tr(spanCell(''), spanCell('')),
      )
    )
    const r = await fillHwpx(tpl, [
      { question: '성명', answer: '홍길동' },
      { question: '소속', answer: '의과대학' },
    ])
    const { texts } = await readSection(r.buffer)
    expect(texts).toEqual(['구분', '성명', '소속', '홍길동', '의과대학'])
  })

  it('이미 라벨이 있는 칸은 덮어쓰지 않고 다음 빈 칸으로 넘어간다', async () => {
    const tpl = await makeHwpx(tbl(tr(spanCell('연구 제목'), spanCell('(필수)'), spanCell(''))))
    const r = await fillHwpx(tpl, [{ question: '연구 제목', answer: '제목입니다' }])
    const { texts } = await readSection(r.buffer)
    expect(texts).toEqual(['연구 제목', '(필수)', '제목입니다'])
  })

  it('안전한 칸을 못 찾으면 라벨 셀을 건드리지 않고 문서 끝에 모은다', async () => {
    const tpl = await makeHwpx(
      tbl(tr(spanCell('연구자 인적사항', 1, 2), spanCell('소속'), spanCell('직위')), tr(spanCell('A'), spanCell('B')))
    )
    const r = await fillHwpx(tpl, [{ question: '연구자 인적사항', answer: '내용' }])
    const { texts } = await readSection(r.buffer)
    expect(r.filled).toBe(0)
    expect(r.unmatched).toEqual(['연구자 인적사항'])
    expect(texts.slice(0, 5)).toEqual(['연구자 인적사항', '소속', '직위', 'A', 'B'])
    expect(texts.slice(-3)).toEqual(['※ 양식에서 위치를 찾지 못한 항목', '[문항] 연구자 인적사항', '내용'])
  })

  it('표 안에서 오른쪽/아래 칸이 모두 없으면 라벨 셀 안에 넣지 않는다', async () => {
    const tpl = await makeHwpx(tbl(tr(spanCell('연구 제목'))))
    const r = await fillHwpx(tpl, [{ question: '연구 제목', answer: '제목입니다' }])
    const { texts } = await readSection(r.buffer)
    expect(texts[0]).toBe('연구 제목')
    expect(r.unmatched).toEqual(['연구 제목'])
  })

  // ── 안내 문구 덮어쓰기 / 하위 라벨 이어 붙이기 ──
  const cellOf = (text: string, charPr = '7') =>
    `<hp:tc><hp:subList>${text
      .split('\n')
      .map(
        (t) =>
          `<hp:p id="0" paraPrIDRef="1" styleIDRef="0"><hp:run charPrIDRef="${charPr}">${
            t ? `<hp:t>${t}</hp:t>` : ''
          }</hp:run></hp:p>`
      )
      .join('')}</hp:subList><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc>`

  it('안내 문구(*표식)가 든 셀은 안내문을 지우고 답변으로 덮어쓴다', async () => {
    const tpl = await makeHwpx(tbl(tr(cellOf('소속'), cellOf('*소속 대학 및 학과 기술'))))
    const r = await fillHwpx(tpl, [{ question: '소속', answer: '의과대학 내과' }])
    const { texts, xml } = await readSection(r.buffer)
    expect(texts).toEqual(['소속', '의과대학 내과'])
    expect(xml).not.toContain('기술')
    expect(r.filled).toBe(1)
  })

  it('파란 글씨 안내문은 덮어쓰고, 같은 서식의 어두운 스타일로 바꾼다', async () => {
    const header =
      '<hh:head xmlns:hh="x"><hh:charPr id="7" textColor="#000000" height="1000"><hh:b/></hh:charPr>' +
      '<hh:charPr id="9" textColor="#0000FF" height="1000"><hh:b/></hh:charPr></hh:head>'
    const tpl = await makeHwpx(tbl(tr(cellOf('직위'), cellOf('직위를 적어 주세요', '9'))), header)
    const r = await fillHwpx(tpl, [{ question: '직위', answer: '교수' }])
    const { texts, xml } = await readSection(r.buffer)
    expect(texts).toEqual(['직위', '교수'])
    expect(xml).not.toContain('charPrIDRef="9"')
    expect(xml).toContain('<hp:t>교수</hp:t>')
  })

  it('하위 라벨("휴대전화 :")은 지우지 않고 뒤에 값을 이어 붙인다', async () => {
    const tpl = await makeHwpx(tbl(tr(cellOf('연락처'), cellOf('휴대전화 :\n연구실 :'))))
    const r = await fillHwpx(tpl, [
      { question: '연락처', answer: '휴대전화: 010-1234-5678\n연구실: 02-123-4567' },
    ])
    const { texts } = await readSection(r.buffer)
    expect(texts).toEqual(['연락처', '휴대전화 : 010-1234-5678', '연구실 : 02-123-4567'])
  })

  it('라벨 없는 줄은 하위 라벨 개수와 같을 때만 순서대로 배분하고, 아니면 문서 끝으로 보낸다', async () => {
    const tpl = await makeHwpx(tbl(tr(cellOf('연락처'), cellOf('휴대전화 :\n연구실 :'))))
    const ok = await fillHwpx(tpl, [{ question: '연락처', answer: '010-1111-2222\n02-333-4444' }])
    expect((await readSection(ok.buffer)).texts.slice(0, 3)).toEqual([
      '연락처', '휴대전화 : 010-1111-2222', '연구실 : 02-333-4444',
    ])
    const bad = await fillHwpx(tpl, [{ question: '연락처', answer: '하나뿐인 값\n둘\n셋' }])
    const { texts } = await readSection(bad.buffer)
    expect(bad.unmatched).toEqual(['연락처'])
    expect(texts.slice(0, 3)).toEqual(['연락처', '휴대전화 :', '연구실 :'])
  })

  it('하위 라벨이 하나뿐이면 전체 답변을 그 뒤에 붙이고, 밑줄 빈칸은 대체한다', async () => {
    const tpl = await makeHwpx(tbl(tr(cellOf('이메일 주소'), cellOf('E-mail : ____'))))
    const r = await fillHwpx(tpl, [{ question: '이메일 주소', answer: 'a@b.com' }])
    expect((await readSection(r.buffer)).texts).toEqual(['이메일 주소', 'E-mail : a@b.com'])
  })

  it('한 셀의 여러 하위 라벨이 각각 문항이면 해당 라벨 뒤에 바로 쓴다', async () => {
    const tpl = await makeHwpx(tbl(tr(cellOf('휴대전화 :\n연구실 :'))))
    const r = await fillHwpx(tpl, [
      { question: '휴대전화', answer: '010-9999-8888' },
      { question: '연구실', answer: '02-555-6666' },
    ])
    expect((await readSection(r.buffer)).texts).toEqual(['휴대전화 : 010-9999-8888', '연구실 : 02-555-6666'])
  })

  it('HWPX가 아니면 에러를 던진다', async () => {
    const zip = new JSZip()
    zip.file('a.txt', 'x')
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    await expect(fillHwpx(buf, [])).rejects.toThrow('section')
  })
})
