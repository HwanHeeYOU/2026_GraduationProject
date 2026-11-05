// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  MISSING_MARKER,
  parseStoredDraft,
  deriveStructure,
  groupMissing,
  mergeSupplements,
  findPatchTargets,
  applyAnswers,
} from '@/lib/irb/draftStore'
import type { IRBFormDraftOutput, IRBFormDraftResult } from '@/lib/irb/types'

const structure: IRBFormDraftResult = {
  questions: [
    { key: 'q_0', label: '연구 제목' },
    { key: 'q_1', label: '문서 버전' },
    { key: 'q_2', label: '연구 목적' },
  ],
  fileSections: [
    { fileName: 'A.hwpx', items: [
      { question: '연구 제목', answerKey: 'q_0' },
      { question: '문서 버전', answerKey: 'q_1' },
    ] },
    { fileName: 'B.hwpx', items: [
      { question: '과제명', answerKey: 'q_0' },
      { question: '서식 버전', answerKey: 'q_1' },
      { question: '연구 목적', answerKey: 'q_2' },
    ] },
  ],
}

const output: IRBFormDraftOutput = {
  sections: [
    { fileName: 'A.hwpx', items: [
      { question: '연구 제목', answer: 'AI 진단 연구' },
      { question: '문서 버전', answer: MISSING_MARKER },
    ] },
    { fileName: 'B.hwpx', items: [
      { question: '과제명', answer: 'AI 진단 연구' },
      { question: '서식 버전', answer: MISSING_MARKER },
      { question: '연구 목적', answer: MISSING_MARKER },
    ] },
  ],
  rawText: '',
}

describe('parseStoredDraft', () => {
  it('새 컬럼 3개를 각각 읽는다', () => {
    const p = parseStoredDraft({
      formDraftJson: JSON.stringify(structure),
      draftOutputJson: JSON.stringify(output),
      userInputJson: JSON.stringify({ userAnswers: { q_0: 'x' }, naturalLanguageInput: '자연어' }),
    })
    expect(p.structure?.questions).toHaveLength(3)
    expect(p.output?.sections).toHaveLength(2)
    expect(p.userInput).toEqual({ userAnswers: { q_0: 'x' }, naturalLanguageInput: '자연어' })
  })

  it('legacy: formDraftJson 에 Output 이 덮어써진 프로젝트도 읽는다 (구조는 null, 유도 구조 제공)', () => {
    const p = parseStoredDraft({ formDraftJson: JSON.stringify(output) })
    expect(p.structure).toBeNull()
    expect(p.output?.sections).toHaveLength(2)
    expect(p.effectiveStructure).not.toBeNull()
    expect(p.userInput).toEqual({ userAnswers: {}, naturalLanguageInput: '' })
  })

  it('깨진 JSON/빈 값에도 죽지 않는다', () => {
    const p = parseStoredDraft({ formDraftJson: '{oops', draftOutputJson: null, userInputJson: 'zzz' })
    expect(p.structure).toBeNull()
    expect(p.output).toBeNull()
    expect(p.effectiveStructure).toBeNull()
  })
})

describe('deriveStructure', () => {
  it('같은 문항 텍스트는 같은 키를 쓴다', () => {
    const d = deriveStructure(output)
    const keyA = d.fileSections[0].items[1].answerKey
    expect(d.questions.map((q) => q.label)).toContain('문서 버전')
    expect(d.fileSections[0].items[0].answerKey).not.toBe(keyA)
  })
})

describe('groupMissing', () => {
  it('서로 다른 표현이라도 같은 answerKey 의 누락은 입력란 1개로 묶는다', () => {
    const g = groupMissing(output, structure)
    expect(g.map((x) => x.answerKey)).toEqual(['q_1', 'q_2'])
    const version = g.find((x) => x.answerKey === 'q_1')!
    expect(version.label).toBe('문서 버전')
    expect(version.items).toEqual([
      { fileName: 'A.hwpx', question: '문서 버전' },
      { fileName: 'B.hwpx', question: '서식 버전' },
    ])
  })
})

describe('mergeSupplements', () => {
  it('새 값은 추가하고, 기존 값이 있으면 이어 붙이며, 빈 입력은 무시한다', () => {
    const m = mergeSupplements({ q_0: '제목', q_1: '1.0' }, [
      { answerKey: 'q_1', supplement: ' 2.0 ' },
      { answerKey: 'q_2', supplement: '목적' },
      { answerKey: 'q_3', supplement: '   ' },
    ])
    expect(m).toEqual({ q_0: '제목', q_1: '1.0\n2.0', q_2: '목적' })
  })
})

describe('findPatchTargets', () => {
  it('보충 입력된 키를 쓰는 모든 파일의 누락 문항만 대상이 된다', () => {
    const t = findPatchTargets(output, structure, ['q_1'])
    expect(t).toEqual([
      { fileName: 'A.hwpx', items: [{ question: '문서 버전', answerKey: 'q_1' }] },
      { fileName: 'B.hwpx', items: [{ question: '서식 버전', answerKey: 'q_1' }] },
    ])
  })
  it('이미 채워진 문항은 같은 키여도 대상이 아니다', () => {
    expect(findPatchTargets(output, structure, ['q_0'])).toEqual([])
  })
})

describe('applyAnswers', () => {
  it('지정한 문항만 바꾸고 나머지(사용자가 채웠거나 수정한 답)는 그대로 둔다', () => {
    const next = applyAnswers(output, [{ fileName: 'B.hwpx', question: '서식 버전', answer: 'v2' }])
    expect(next.sections[0].items).toEqual(output.sections[0].items)
    expect(next.sections[1].items.map((i) => i.answer)).toEqual(['AI 진단 연구', 'v2', MISSING_MARKER])
    expect(next.rawText).toContain('[문항] 서식 버전\n[답변] v2')
    // 원본은 변경되지 않는다
    expect(output.sections[1].items[1].answer).toBe(MISSING_MARKER)
  })
})
