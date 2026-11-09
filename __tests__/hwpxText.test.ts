// @vitest-environment node
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { hwpxToText } from '@/lib/hwp/hwpxText'

const NS =
  'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"'

const p = (text: string, charPr = '0') =>
  `<hp:p><hp:run charPrIDRef="${charPr}">${text ? `<hp:t>${text}</hp:t>` : ''}</hp:run></hp:p>`
const tc = (text: string, charPr = '0') => `<hp:tc><hp:subList>${p(text, charPr)}</hp:subList></hp:tc>`
const tr = (...cells: string[]) => `<hp:tr>${cells.join('')}</hp:tr>`
const tbl = (...rows: string[]) =>
  `<hp:p><hp:run charPrIDRef="0"><hp:tbl>${rows.join('')}</hp:tbl></hp:run></hp:p>`

async function make(body: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    'Contents/header.xml',
    `<hh:head ${NS}><hh:charPr id="0" textColor="#000000"/><hh:charPr id="5" textColor="#2E74B5"/></hh:head>`,
  )
  zip.file('Contents/section0.xml', `<hs:sec ${NS}>${body}</hs:sec>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('hwpxToText', () => {
  it('표는 행마다 한 줄(셀은 | 로 구분), 파란 글씨는 〔예시〕 로 표시한다', async () => {
    const buf = await make(
      p('2. 지출내역 (단위 : 원)') +
        tbl(
          tr(tc('구분'), tc('내역'), tc('예산액'), tc('비고')),
          tr(tc('1'), tc('사례비, 재료비 등 기재', '5'), tc(''), tc('세부내역 기재', '5')),
          tr(tc('2'), tc(''), tc(''), tc('')),
        ) +
        p('위와 같이 제출합니다.'),
    )
    expect(await hwpxToText(buf)).toBe(
      [
        '2. 지출내역 (단위 : 원)',
        '구분 | 내역 | 예산액 | 비고',
        '1 | 〔예시〕 사례비, 재료비 등 기재 |  | 〔예시〕 세부내역 기재',
        '2 |  |  | ',
        '위와 같이 제출합니다.',
      ].join('\n'),
    )
  })

  it('section 파일이 없으면 null', async () => {
    const zip = new JSZip()
    zip.file('a.txt', 'x')
    expect(await hwpxToText(await zip.generateAsync({ type: 'nodebuffer' }))).toBeNull()
  })
})
