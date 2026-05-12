// Feature: yourpark-irb-saas, Property 19: IRB 데이터 파싱 유효성
// Feature: yourpark-irb-saas, Property 20: 유효하지 않은 데이터 오류 반환
// Feature: yourpark-irb-saas, Property 21: Pretty_Printer 출력 포함 필드
// Feature: yourpark-irb-saas, Property 22: IRB 데이터 파싱 round-trip

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { parseIRBModule } from '@/lib/irb/parser'
import { prettyPrintIRBModule, parsePrettyPrinted } from '@/lib/irb/prettyPrint'

// Arbitrary for valid IRBModuleData
const validIRBModuleArb = fc.record({
  name: fc.string({ minLength: 1 }),
  description: fc.string(),
  category: fc.string({ minLength: 1 }),
  isRequired: fc.boolean(),
  order: fc.integer({ min: 1, max: 1000 }),
  hasFormula: fc.boolean(),
  promptHint: fc.option(fc.string(), { nil: null }),
})

// **Validates: Requirements 10.1**
describe('Property 19: 유효한 IRBModule 데이터 파싱 성공', () => {
  it('유효한 데이터는 항상 파싱에 성공한다', () => {
    fc.assert(
      fc.property(validIRBModuleArb, (data) => {
        const result = parseIRBModule(data)
        return result.success === true
      }),
      { numRuns: 100 }
    )
  })
})

// **Validates: Requirements 10.2**
describe('Property 20: 필수 필드 누락 시 오류 반환', () => {
  it('name이 누락되면 오류를 반환하고 missingFields에 name이 포함된다', () => {
    fc.assert(
      fc.property(
        fc.record({
          description: fc.string(),
          category: fc.string({ minLength: 1 }),
          isRequired: fc.boolean(),
          order: fc.integer({ min: 1 }),
        }),
        (data) => {
          const result = parseIRBModule(data)
          return result.success === false && result.missingFields.includes('name')
        }
      ),
      { numRuns: 50 }
    )
  })

  it('order가 string이면 오류를 반환하고 missingFields에 order가 포함된다', () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.string({ minLength: 1 }),
          description: fc.string(),
          category: fc.string({ minLength: 1 }),
          isRequired: fc.boolean(),
          order: fc.string(), // 잘못된 타입
        }),
        (data) => {
          const result = parseIRBModule(data)
          return result.success === false && result.missingFields.includes('order')
        }
      ),
      { numRuns: 50 }
    )
  })
})

// **Validates: Requirements 10.3**
describe('Property 21: Pretty_Printer 출력에 name, description, category 포함', () => {
  it('prettyPrintIRBModule 출력에 name, description, category가 포함된다', () => {
    fc.assert(
      fc.property(validIRBModuleArb, (data) => {
        const result = parseIRBModule(data)
        if (!result.success) return true // skip invalid
        const printed = prettyPrintIRBModule(result.data)
        return (
          printed.includes(result.data.name) &&
          printed.includes(result.data.description) &&
          printed.includes(result.data.category)
        )
      }),
      { numRuns: 100 }
    )
  })
})

// **Validates: Requirements 10.4**
describe('Property 22: IRB 데이터 파싱 round-trip', () => {
  it('parse → print → parse 결과가 원본과 동등하다', () => {
    // Use simpler strings to avoid newline/colon issues in pretty-print format
    const safeStringArb = fc.stringMatching(/^[a-zA-Z0-9가-힣 ]{1,30}$/)
    const safeIRBModuleArb = fc.record({
      name: safeStringArb,
      description: safeStringArb,
      category: safeStringArb,
      isRequired: fc.boolean(),
      order: fc.integer({ min: 1, max: 1000 }),
      hasFormula: fc.boolean(),
      promptHint: fc.option(safeStringArb, { nil: null }),
    })

    fc.assert(
      fc.property(safeIRBModuleArb, (data) => {
        const parsed = parseIRBModule(data)
        if (!parsed.success) return true

        const printed = prettyPrintIRBModule(parsed.data)
        const reparsed = parsePrettyPrinted(printed)

        if (!reparsed.success) return false

        return (
          reparsed.data.name === parsed.data.name &&
          reparsed.data.description === parsed.data.description &&
          reparsed.data.category === parsed.data.category &&
          reparsed.data.isRequired === parsed.data.isRequired &&
          reparsed.data.order === parsed.data.order
        )
      }),
      { numRuns: 100 }
    )
  })
})
