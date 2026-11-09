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

  it('라벨 없는 전화번호 한 줄은 이름이 맞는 하위 라벨(휴대전화)에만 넣는다', async () => {
    const tpl = await makeHwpx(tbl(tr(cellOf('연락처'), cellOf('휴대전화 :\n연구실 :'))))
    const r = await fillHwpx(tpl, [{ question: '연락처', answer: '010-1234-5678' }])
    expect(r.unmatched).toEqual([])
    expect((await readSection(r.buffer)).texts).toEqual(['연락처', '휴대전화 : 010-1234-5678', '연구실 :'])
  })

  it('전화번호와 이메일이 섞여 오면 종류별로 알맞은 하위 라벨에 넣고, 종류를 모르면 쓰지 않는다', async () => {
    const tpl = await makeHwpx(tbl(tr(cellOf('연락처'), cellOf('휴대전화 :\nE-mail :\n연구실 :'))))
    const ok = await fillHwpx(tpl, [{ question: '연락처', answer: 'a@b.com\n010-1111-2222' }])
    expect((await readSection(ok.buffer)).texts).toEqual(['연락처', '휴대전화 : 010-1111-2222', 'E-mail : a@b.com', '연구실 :'])
    const bad = await fillHwpx(tpl, [{ question: '연락처', answer: '서울시 어딘가' }])
    expect(bad.unmatched).toEqual(['연락처'])
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

  // ── "연구책임자 / 공동연구자 / 연구원" 처럼 병합된 그룹 칸 + 하위 라벨(성명·소속·직위) 구조 ──
  const spanOf = (text: string, colSpan = 1, rowSpan = 1) =>
    `<hp:tc><hp:subList>${text
      .split('\n')
      .map((t) => `<hp:p id="0" paraPrIDRef="1" styleIDRef="0"><hp:run charPrIDRef="7">${t ? `<hp:t>${t}</hp:t>` : ''}</hp:run></hp:p>`)
      .join('')}</hp:subList><hp:cellSpan colSpan="${colSpan}" rowSpan="${rowSpan}"/></hp:tc>`
  const POS = '□ 교수     □ 박사과정 대학원생     □ 석사과정 대학원생\n□ 학부생   □ 기타( 예:박사후연구원, 시간강사  )'
  const peopleTable = () =>
    tbl(
      tr(spanOf('연구책임자', 1, 3), spanOf('성 명'), spanOf('')),
      tr(spanOf('소 속'), spanOf('대학/대학원                      학과/학부')),
      tr(spanOf('직 위'), spanOf(POS)),
      tr(spanOf('공동연구자 (*2인 이상인 경우 칸을 추가하여 모두 작성)', 1, 4), spanOf('□ 해당없음', 2)),
      tr(spanOf('성 명'), spanOf('')),
      tr(spanOf('소 속'), spanOf('')),
      tr(spanOf('직 위'), spanOf('')),
    )

  it('"공동연구자 성명" 처럼 그룹 + 하위 라벨 문항을 병합된 그룹 칸 아래 알맞은 행에 넣는다', async () => {
    const tpl = await makeHwpx(para('2. 연구책임자, 공동연구자 및 연구원의 성명, 소속 및 직위') + peopleTable())
    const r = await fillHwpx(tpl, [
      { question: '연구책임자 성명', answer: '김민수' },
      { question: '연구책임자 소속', answer: '한국대학교 심리학과' },
      { question: '연구책임자 직위', answer: '조교수' },
      { question: '공동연구자 성명', answer: '박서연' },
      { question: '공동연구자 소속', answer: '한국대학교 심리학과' },
      { question: '공동연구자 직위', answer: '부교수' },
    ])
    expect(r.unmatched).toEqual([])
    expect(r.filled).toBe(6)
    const { texts } = await readSection(r.buffer)
    expect(texts).toEqual([
      '2. 연구책임자, 공동연구자 및 연구원의 성명, 소속 및 직위',
      '연구책임자', '성 명', '김민수',
      '소 속', '한국대학교 심리학과', // 자리표시 문구("대학/대학원 학과/학부")는 지워진다
      '직 위', '□ 교수     □ 박사과정 대학원생     □ 석사과정 대학원생'.replace('□ 교수', '☑ 교수'), '□ 학부생   □ 기타( 예:박사후연구원, 시간강사  )',
      '공동연구자 (*2인 이상인 경우 칸을 추가하여 모두 작성)', '□ 해당없음',
      '성 명', '박서연', '소 속', '한국대학교 심리학과', '직 위', '부교수',
    ])
  })

  it('직위가 선택지에 없으면 "기타" 를 체크하고 괄호 안을 답변으로 바꾼다', async () => {
    const tpl = await makeHwpx(peopleTable())
    const r = await fillHwpx(tpl, [{ question: '연구책임자 직위', answer: '박사후연구원' }])
    expect(r.unmatched).toEqual([])
    const { texts } = await readSection(r.buffer)
    expect(texts).toContain('□ 학부생   ☑ 기타(박사후연구원)')
    expect(texts).toContain('□ 교수     □ 박사과정 대학원생     □ 석사과정 대학원생')
  })

  it('"석사과정 대학원생" 처럼 항목 이름과 같은 답변은 그 항목만 체크한다', async () => {
    const tpl = await makeHwpx(peopleTable())
    const r = await fillHwpx(tpl, [{ question: '연구책임자 직위', answer: '석사과정 대학원생' }])
    const { texts } = await readSection(r.buffer)
    expect(texts).toContain('□ 교수     □ 박사과정 대학원생     ☑ 석사과정 대학원생')
  })

  it('"공동연구자 성명 / 소속 / 직위" 처럼 묶인 문항은 답변을 " / " 로 나눠 하위 라벨마다 넣는다', async () => {
    const tpl = await makeHwpx(peopleTable())
    const r = await fillHwpx(tpl, [
      { question: '공동연구자 성명 / 소속 / 직위', answer: '박서연 / 한국대학교 심리학과 / 부교수' },
    ])
    expect(r.unmatched).toEqual([])
    const { texts } = await readSection(r.buffer)
    expect(texts.slice(-6)).toEqual(['성 명', '박서연', '소 속', '한국대학교 심리학과', '직 위', '부교수'])
    // 연구책임자 쪽 같은 라벨 칸은 건드리지 않는다
    expect(texts).toContain('대학/대학원                      학과/학부')
  })

  it('묶인 문항에서 여러 명이면 하위 라벨 칸마다 한 줄씩 넣는다', async () => {
    const tpl = await makeHwpx(peopleTable())
    const r = await fillHwpx(tpl, [
      { question: '공동연구자 성명 / 소속 / 직위', answer: '박서연 / 한국대 / 부교수\n이도윤 / 연구센터 / 연구원' },
    ])
    const { texts } = await readSection(r.buffer)
    expect(texts.slice(-9)).toEqual(['성 명', '박서연', '이도윤', '소 속', '한국대', '연구센터', '직 위', '부교수', '연구원'])
  })

  // ── 라벨 + 템플릿 문단, 제목 구역 ──
  it('"3. 연구기간 : IRB승인후부터 ~ 0000년 00월 00일" 은 콜론 앞 라벨로 찾고 템플릿을 답변으로 바꾼다', async () => {
    const tpl = await makeHwpx(para('3. 연구기간 :  IRB승인후부터 ~ 0000년 00월 00일') + para('4. 연구대상'))
    const r = await fillHwpx(tpl, [{ question: '연구기간', answer: 'IRB 승인 후부터 2027년 12월 31일까지' }])
    expect(r.unmatched).toEqual([])
    expect((await readSection(r.buffer)).texts).toEqual(['3. 연구기간 : IRB 승인 후부터 2027년 12월 31일까지', '4. 연구대상'])
  })

  // 양식의 안내문은 파란 글씨 (charPr 9)
  const BLUE_HEADER = '<hh:head xmlns:hh="x"><hh:charPr id="7" textColor="#000000"/><hh:charPr id="9" textColor="#2E74B5"/></hh:head>'
  const guide = (t: string) => para(t).replace('charPrIDRef="7"', 'charPrIDRef="9"')
  const sectionDoc = () =>
    para('2) 연구참여로 발생할 수 있는 위험 및 손실에 대한 안전대책과 보상') +
    guide('- 안전대책과 보상방안을 구체적으로 기술') +
    para('4) 개인정보 보호 및 제공에 관한 사항') +
    guide('- 수집하는 개인정보의 항목을 구체적으로 모두 기술') +
    guide('- 제3자 혹은 다른 연구에 제공 여부를 기술.') +
    para('5) 자발적 참여, 자유로운 동의 철회') +
    guide('- 철회시 연구대상자의 자료 및 정보에 대한 처리방법을 기술')

  it('제목이 문항보다 길면 문항 단어가 전부 든 제목 아래에 넣는다 (안전대책과 보상)', async () => {
    const r = await fillHwpx(await makeHwpx(sectionDoc(), BLUE_HEADER), [{ question: '안전대책과 보상', answer: '보상 없음' }])
    expect(r.unmatched).toEqual([])
    const { texts } = await readSection(r.buffer)
    expect(texts.slice(0, 3)).toEqual(['2) 연구참여로 발생할 수 있는 위험 및 손실에 대한 안전대책과 보상', '보상 없음', '- 안전대책과 보상방안을 구체적으로 기술'])
  })

  it('한 제목 아래 안내문에서 뽑힌 하위 문항 여러 개는 "문항: 답변" 줄로 묶어 그 제목 아래에 넣는다', async () => {
    const r = await fillHwpx(await makeHwpx(sectionDoc(), BLUE_HEADER), [
      { question: '개인정보 수집 항목', answer: '이름, 연락처' },
      { question: '개인정보 제공 여부', answer: '제공하지 않음' },
      { question: '동의 철회 시 자료 처리 방법', answer: '즉시 폐기' },
    ])
    expect(r.unmatched).toEqual([])
    const { texts } = await readSection(r.buffer)
    expect(texts).toEqual([
      '2) 연구참여로 발생할 수 있는 위험 및 손실에 대한 안전대책과 보상',
      '- 안전대책과 보상방안을 구체적으로 기술',
      '4) 개인정보 보호 및 제공에 관한 사항',
      '개인정보 수집 항목: 이름, 연락처',
      '개인정보 제공 여부: 제공하지 않음',
      '- 수집하는 개인정보의 항목을 구체적으로 모두 기술',
      '- 제3자 혹은 다른 연구에 제공 여부를 기술.',
      '5) 자발적 참여, 자유로운 동의 철회',
      '즉시 폐기',
      '- 철회시 연구대상자의 자료 및 정보에 대한 처리방법을 기술',
    ])
  })

  it('이미 답이 들어간 제목 구역도 같이 쓰고, 이미 들어간 내용이면 다시 넣지 않는다', async () => {
    const doc =
      para('2) 연구참여로 발생할 수 있는 위험 및 손실에 대한 안전대책과 보상') +
      guide('- 안전대책과 보상방안을 구체적으로 기술') +
      guide('- 보상계획이 없을 시는 “보상계획 없음”으로 명시')
    const r = await fillHwpx(await makeHwpx(doc, BLUE_HEADER), [
      { question: '안전대책과 보상', answer: '피로 시 휴식 제공. 보상계획은 없습니다.' },
      { question: '보상계획 없음', answer: '보상계획은 없습니다.' },
      { question: '보상방안', answer: '치료비 지원' },
    ])
    expect(r.unmatched).toEqual([])
    expect(r.filled).toBe(3)
    const { texts } = await readSection(r.buffer)
    expect(texts.slice(0, 4)).toEqual([
      '2) 연구참여로 발생할 수 있는 위험 및 손실에 대한 안전대책과 보상',
      '안전대책과 보상: 피로 시 휴식 제공. 보상계획은 없습니다.',
      '보상방안: 치료비 지원',
      '- 안전대책과 보상방안을 구체적으로 기술',
    ])
  })

  it('"여부"·"또는" 같은 꼬리말은 제목 구역 비교에서 뺀다', async () => {
    const r = await fillHwpx(await makeHwpx(sectionDoc(), BLUE_HEADER), [
      { question: '개인정보 제3자 또는 다른 연구 제공 여부', answer: '제공하지 않음' },
    ])
    expect(r.unmatched).toEqual([])
    const { texts } = await readSection(r.buffer)
    expect(texts[texts.indexOf('4) 개인정보 보호 및 제공에 관한 사항') + 1]).toBe('제공하지 않음')
  })

  it('어느 제목 구역인지 알 수 없으면(같은 점수가 둘 이상) 추측하지 않고 문서 끝으로 보낸다', async () => {
    const tpl = await makeHwpx(
      para('1) 알파 항목') + guide('- 라마바 사아자를 기술') + para('2) 베타 항목') + guide('- 라마바 사아자를 기술'),
      BLUE_HEADER,
    )
    const r = await fillHwpx(tpl, [{ question: '라마바 사아자', answer: '값' }])
    expect(r.unmatched).toEqual(['라마바 사아자'])
  })

  it('그룹 이름이 다르면 엉뚱한 행에 넣지 않는다', async () => {
    const tpl = await makeHwpx(peopleTable())
    const r = await fillHwpx(tpl, [{ question: '지도교수 성명', answer: '이교수' }])
    expect(r.unmatched).toEqual(['지도교수 성명'])
  })

  it('HWPX가 아니면 에러를 던진다', async () => {
    const zip = new JSZip()
    zip.file('a.txt', 'x')
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    await expect(fillHwpx(buf, [])).rejects.toThrow('section')
  })

  it('문구가 다소 달라도(완화 매칭) 양식 칸에 채운다', async () => {
    const tpl = await makeHwpx(tbl(tr(cell(0, 0, '연구대상자 선정 기준 및 제외 기준'), cell(1, 0, ''))))
    const r = await fillHwpx(tpl, [{ question: '연구대상자 선정기준', answer: '만 19세 이상 성인' }])
    const { texts } = await readSection(r.buffer)
    expect(texts).toEqual(['연구대상자 선정 기준 및 제외 기준', '만 19세 이상 성인'])
    expect(r.unmatched).toEqual([])
  })
})

describe('fillHwpx - 열 머리글이 있는 여러 건 입력 표', () => {
  const header = tr(cell(0, 0, '구분'), cell(1, 0, '내역'), cell(2, 0, '예산액'), cell(3, 0, '비고'))
  const empty = (r: number) => tr(cell(0, r, ''), cell(1, r, ''), cell(2, r, ''), cell(3, r, ''))
  const Q = '연구비 예산 (구분 / 내역 / 예산액 / 비고) - 여러 건 입력'

  it('한 줄을 4개 열로 쪼개 행마다 넣는다', async () => {
    const tpl = await makeHwpx(tbl(header, empty(1), empty(2)))
    const r = await fillHwpx(tpl, [
      { question: Q, answer: '인건비 / 연구보조원 / 3,000,000원 / 6개월\n재료비 / 설문 인쇄 / 500,000원 / -' },
    ])
    const { texts } = await readSection(r.buffer)
    expect(texts).toEqual([
      '구분', '내역', '예산액', '비고',
      '인건비', '연구보조원', '3,000,000원', '6개월',
      '재료비', '설문 인쇄', '500,000원', '-',
    ])
    expect(r.filled).toBe(1)
    expect(r.unmatched).toEqual([])
  })

  it('빈 행이 모자라면 행을 복제해 늘린다', async () => {
    const tpl = await makeHwpx(tbl(header, empty(1)))
    const r = await fillHwpx(tpl, [
      { question: Q, answer: 'A / a / 1 / x\nB / b / 2 / y\nC / c / 3 / z' },
    ])
    const { texts, xml } = await readSection(r.buffer)
    expect(texts.slice(4)).toEqual(['A', 'a', '1', 'x', 'B', 'b', '2', 'y', 'C', 'c', '3', 'z'])
    expect(xml).toContain('rowAddr="3"')
    expect(r.unmatched).toEqual([])
  })

  it('괄호·표 이름 없이 "열1 / 열2 … - 여러 건 입력" 이어도 열을 나눠 넣는다', async () => {
    const tpl = await makeHwpx(tbl(header, empty(1), empty(2)))
    const r = await fillHwpx(tpl, [
      { question: '구분 / 내역 / 예산액 / 비고 - 여러 건 입력', answer: '인건비 / 보조원 / 3,000,000원 / 6개월\n재료비 / 인쇄 / 500,000원 / -' },
    ])
    const { texts } = await readSection(r.buffer)
    expect(texts.slice(4)).toEqual(['인건비', '보조원', '3,000,000원', '6개월', '재료비', '인쇄', '500,000원', '-'])
    expect(r.unmatched).toEqual([])
  })

  it('"여러 건 입력" 표식이 없는 "A / B" 문항은 열 표로 보지 않는다', async () => {
    const tpl = await makeHwpx(tbl(header, empty(1)))
    const r = await fillHwpx(tpl, [{ question: '구분 / 내역', answer: '가 / 나' }])
    const { texts } = await readSection(r.buffer)
    expect(texts.slice(4)).not.toEqual(['가', '나', '', ''])
  })

  it('소제목 두 개가 한 표로 이어진 양식에서 두 번째 머리글 표도 채운다', async () => {
    const title = (r: number, t: string) => tr(
      `<hp:tc><hp:subList>${para(t)}</hp:subList><hp:cellAddr colAddr="0" rowAddr="${r}"/><hp:cellSpan colSpan="3" rowSpan="1"/></hp:tc>`,
    )
    const row3 = (r: number, a = '', b = '', c = '') => tr(cell(0, r, a), cell(1, r, b), cell(2, r, c))
    const tpl = await makeHwpx(
      tbl(
        title(0, '근무 경력'), row3(1, '기간', '소속', '직위'), row3(2),
        title(3, '연구 경력'), row3(4, '년도', '연구 제목', '연구 내용'), row3(5),
      ),
    )
    const r = await fillHwpx(tpl, [
      { question: '근무 경력 (기간 / 소속 / 직위) - 여러 건 입력', answer: '2024 / 대학 / 교수\n2022 / 센터 / 조교' },
      { question: '연구 경력 (년도 / 연구 제목 / 연구 내용) - 여러 건 입력', answer: '2023 / 훈련 연구 / 참여' },
    ])
    const { texts } = await readSection(r.buffer)
    expect(r.unmatched).toEqual([])
    expect(texts).toEqual([
      '근무 경력', '기간', '소속', '직위', '2024', '대학', '교수', '2022', '센터', '조교',
      '연구 경력', '년도', '연구 제목', '연구 내용', '2023', '훈련 연구', '참여',
    ])
  })

  it('머리글 없는 빈 표(제목에 작성 안내가 붙음)에는 "- 여러 건 입력" 문항을 제목 아래 칸에 넣는다', async () => {
    const wide = `<hp:tc><hp:subList>${para('5. 기타 (자격사항 등) (필요시 칸을 추가하여 기재하십시오)')}</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="2" rowSpan="1"/></hp:tc>`
    const tpl = await makeHwpx(tbl(tr(wide), tr(cell(0, 1, ''), cell(1, 1, ' ')), tr(cell(0, 2, ' '), cell(1, 2, ''))))
    const r = await fillHwpx(tpl, [
      { question: '기타 (자격사항 등) - 여러 건 입력', answer: '임상심리사 2급\n정회원' },
    ])
    const { texts } = await readSection(r.buffer)
    expect(r.unmatched).toEqual([])
    expect(texts.filter((t) => t.trim())).toEqual(['5. 기타 (자격사항 등) (필요시 칸을 추가하여 기재하십시오)', '임상심리사 2급', '정회원'])
  })

  // 셀별 글자 (셀 하나 = 배열 한 칸)
  async function cellTexts(buf: Buffer): Promise<string[]> {
    const { xml } = await readSection(buf)
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    return Array.from(doc.getElementsByTagName('hp:tc')).map((tc) =>
      Array.from(tc.getElementsByTagName('hp:t')).map((t) => t.textContent ?? '').join('\n').trim(),
    )
  }
  const titleRow = `<hp:tc><hp:subList>${para('5. 기타 (자격사항 등)')}</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="2" rowSpan="1"/></hp:tc>`
  const blankRow = (r: number) => tr(cell(0, r, ''), cell(1, r, ''))
  const Q5 = '기타 (자격사항 등) - 여러 건 입력'

  it('머리글 없는 빈 칸 영역은 한 건당 한 칸씩 읽는 순서대로 넣는다', async () => {
    const tpl = await makeHwpx(tbl(tr(titleRow), blankRow(1), blankRow(2)))
    const r = await fillHwpx(tpl, [{ question: Q5, answer: '가\n나\n다' }])
    expect(await cellTexts(r.buffer)).toEqual(['5. 기타 (자격사항 등)', '가', '나', '다', ''])
    expect(r.unmatched).toEqual([])
  })

  it('칸이 모자라면 마지막 행을 복제해 늘린다', async () => {
    const tpl = await makeHwpx(tbl(tr(titleRow), blankRow(1)))
    const r = await fillHwpx(tpl, [{ question: Q5, answer: '가\n나\n다\n라\n마' }])
    expect(await cellTexts(r.buffer)).toEqual(['5. 기타 (자격사항 등)', '가', '나', '다', '라', '마', ''])
  })

  it('한 줄에 " / " 로 이어진 답변도 건 단위로 나눠 칸마다 넣는다', async () => {
    const tpl = await makeHwpx(tbl(tr(titleRow), blankRow(1)))
    const r = await fillHwpx(tpl, [{ question: Q5, answer: '임상심리사 2급 / 정회원' }])
    expect(await cellTexts(r.buffer)).toEqual(['5. 기타 (자격사항 등)', '임상심리사 2급', '정회원'])
  })

  it('"여러 건 입력" 표식이 없으면 기존처럼 첫 칸에 줄바꿈으로 넣는다', async () => {
    const tpl = await makeHwpx(tbl(tr(titleRow), blankRow(1)))
    const r = await fillHwpx(tpl, [{ question: '기타 (자격사항 등)', answer: '가\n나' }])
    expect(await cellTexts(r.buffer)).toEqual(['5. 기타 (자격사항 등)', '가\n나', ''])
  })

  it('합계처럼 이미 채워진 행 앞에서 멈추고 남는 줄은 복제로 넣는다', async () => {
    const total = tr(cell(0, 2, '합계'), cell(1, 2, ''), cell(2, 2, ''), cell(3, 2, ''))
    const tpl = await makeHwpx(tbl(header, empty(1), total))
    const r = await fillHwpx(tpl, [{ question: Q, answer: 'A / a / 1 / x\nB / b / 2 / y' }])
    const { texts } = await readSection(r.buffer)
    expect(texts.slice(4, 12)).toEqual(['A', 'a', '1', 'x', 'B', 'b', '2', 'y'])
    expect(texts[texts.length - 1]).toBe('합계')
  })
})
