// Feature: yourpark-irb-saas
// Unit test: AI generate prompt building

import { describe, it, expect } from 'vitest'
import { buildIRBPrompt } from '@/lib/irb/buildPrompt'

describe('buildIRBPrompt', () => {
  it('키워드가 프롬프트에 포함된다', () => {
    const prompt = buildIRBPrompt({
      moduleName: '연구 목적',
      moduleDescription: '연구의 목적을 기술',
      moduleCategory: '기본정보',
      promptHint: null,
      keywords: '암 치료 임상시험',
    })
    expect(prompt).toContain('암 치료 임상시험')
  })

  it('모듈명이 프롬프트에 포함된다', () => {
    const prompt = buildIRBPrompt({
      moduleName: '표본 크기 계산',
      moduleDescription: '통계적 근거에 기반한 연구 대상자 수 산출',
      moduleCategory: '연구방법',
      promptHint: '검정력, 유의수준, 효과크기를 포함',
      keywords: '당뇨병 연구',
    })
    expect(prompt).toContain('표본 크기 계산')
  })

  it('promptHint가 있으면 프롬프트에 포함된다', () => {
    const hint = '검정력, 유의수준, 효과크기를 포함한 표본 크기 계산식 제시'
    const prompt = buildIRBPrompt({
      moduleName: '표본 크기 계산',
      moduleDescription: '통계적 근거에 기반한 연구 대상자 수 산출',
      moduleCategory: '연구방법',
      promptHint: hint,
      keywords: '당뇨병',
    })
    expect(prompt).toContain(hint)
  })

  it('non-empty string을 반환한다', () => {
    const prompt = buildIRBPrompt({
      moduleName: '연구 목적',
      moduleDescription: '설명',
      moduleCategory: '기본정보',
      promptHint: null,
      keywords: '키워드',
    })
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })
})
