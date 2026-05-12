// Feature: yourpark-irb-saas, Property 10: AI 생성 요청 파라미터 검증
// Feature: yourpark-irb-saas, Property 11: AI 응답 JSON 형식

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildIRBPrompt } from '@/lib/irb/buildPrompt'

// **Validates: Requirements 5.3, 6.1, 6.4**
describe('Property 10: buildIRBPrompt 출력에 keywords와 moduleName 포함', () => {
  it('임의의 keywords와 moduleName에 대해 프롬프트에 두 값이 모두 포함된다', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (keywords, moduleName) => {
          const prompt = buildIRBPrompt({
            moduleName,
            moduleDescription: '설명',
            moduleCategory: '카테고리',
            promptHint: null,
            keywords,
          })
          return prompt.includes(keywords) && prompt.includes(moduleName)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// **Validates: Requirements 5.4, 6.3**
describe('Property 11: 임의 moduleId에 대해 buildIRBPrompt가 항상 non-empty string 반환', () => {
  it('임의의 입력에 대해 항상 non-empty string을 반환한다', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string(),
        fc.string({ minLength: 1 }),
        fc.option(fc.string(), { nil: null }),
        fc.string({ minLength: 1 }),
        (moduleName, moduleDescription, moduleCategory, promptHint, keywords) => {
          const prompt = buildIRBPrompt({
            moduleName,
            moduleDescription,
            moduleCategory,
            promptHint,
            keywords,
          })
          return typeof prompt === 'string' && prompt.length > 0
        }
      ),
      { numRuns: 100 }
    )
  })
})
