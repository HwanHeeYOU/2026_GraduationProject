// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fitNaturalInput, NATURAL_INPUT_MAX_CHARS, OMISSION_MARK } from '@/lib/irb/naturalInput'

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `[${i}] 본 연구는 성인 참여자를 대상으로 작업기억 훈련의 효과를 검증한다. 대상자는 만 19~39세 건강한 성인이다.`).join('\n')

describe('fitNaturalInput', () => {
  it('한도 이내면 그대로 보낸다 (예전에는 4000자에서 잘렸다)', () => {
    const text = filler(60) + '\n학력: 2008 한국대 학사'
    expect(text.length).toBeGreaterThan(4000)
    expect(text.length).toBeLessThan(NATURAL_INPUT_MAX_CHARS)
    expect(fitNaturalInput(text, ['학력 (기간 / 학교 / 학위명) - 여러 건 입력'])).toBe(text)
  })

  it('한도를 넘으면 문항과 관련 있는 문단을 우선 남기고 한도를 지킨다', () => {
    const text = filler(200) + '\n연락처 휴대전화 010-1234-5678, 이메일 minsu@example.com\n학력: 2008 한국대 학사\n' + filler(100)
    expect(text.length).toBeGreaterThan(NATURAL_INPUT_MAX_CHARS)
    const out = fitNaturalInput(text, ['연락처', '이메일', '학력 (기간 / 학교 / 학위명) - 여러 건 입력'])
    expect(out).toContain('010-1234-5678')
    expect(out).toContain('minsu@example.com')
    expect(out).toContain('학력: 2008 한국대 학사')
    expect(out.length).toBeLessThanOrEqual(NATURAL_INPUT_MAX_CHARS + 200)
    expect(out).toContain(OMISSION_MARK)
  })

  it('관련 문단은 원래 순서를 지킨다', () => {
    const text = filler(300) + '\n학력: A\n' + filler(10) + '\n근무 경력: B\n' + filler(300)
    const out = fitNaturalInput(text, ['학력', '근무 경력'], 3000)
    expect(out.indexOf('학력: A')).toBeGreaterThan(-1)
    expect(out.indexOf('근무 경력: B')).toBeGreaterThan(out.indexOf('학력: A'))
  })

  it('빈 입력은 빈 문자열', () => {
    expect(fitNaturalInput('', ['x'])).toBe('')
  })
})
