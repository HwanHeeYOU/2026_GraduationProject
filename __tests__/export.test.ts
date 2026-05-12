// Feature: yourpark-irb-saas
// Unit test: Incomplete item detection for export warning

import { describe, it, expect } from 'vitest'

// 순수 함수: 미완성 항목 감지 로직
function hasIncompleteModules(modules: Array<{ content: string }>): boolean {
  return modules.some((m) => m.content.trim() === '')
}

describe('미완성 항목 감지', () => {
  it('content가 빈 문자열인 모듈은 미완성으로 감지된다', () => {
    const modules = [
      { content: '작성된 내용' },
      { content: '' },
    ]
    expect(hasIncompleteModules(modules)).toBe(true)
  })

  it('content가 공백만인 모듈은 미완성으로 감지된다', () => {
    const modules = [
      { content: '작성된 내용' },
      { content: '   ' },
    ]
    expect(hasIncompleteModules(modules)).toBe(true)
  })

  it('모든 모듈이 작성된 경우 미완성 없음', () => {
    const modules = [
      { content: '연구 목적 내용' },
      { content: '표본 크기 계산 내용' },
    ]
    expect(hasIncompleteModules(modules)).toBe(false)
  })

  it('빈 모듈 목록은 미완성 없음', () => {
    expect(hasIncompleteModules([])).toBe(false)
  })

  it('탭 문자만 있는 경우도 미완성으로 감지된다', () => {
    const modules = [{ content: '\t\n' }]
    expect(hasIncompleteModules(modules)).toBe(true)
  })
})
