// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MISSING_MARKER } from '@/lib/irb/draftStore'

// ── 외부 의존성 목킹 ─────────────────────────────────────────
const state: {
  project: Record<string, unknown> | null
  updated: Record<string, unknown> | null
  createdMany: Record<string, unknown> | null
} = {
  project: null,
  updated: null,
  createdMany: null,
}
const generateText = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/ai-client', () => ({
  generateText: (...a: unknown[]) => generateText(...a),
  isLuxiaProvider: () => true,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: {
      findFirst: async () => state.project,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.updated = data
        return {}
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        state.createdMany = data
        return {}
      },
    },
  },
}))

import { PATCH, POST } from '@/app/api/ai/irb-form-draft/route'
import { PUT } from '@/app/api/projects/[id]/draft/route'

const structure = {
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
      { question: '서식 버전', answerKey: 'q_1' },
      { question: '연구 목적', answerKey: 'q_2' },
    ] },
  ],
}
const output = {
  sections: [
    { fileName: 'A.hwpx', items: [
      { question: '연구 제목', answer: '사용자가 직접 고친 제목' },
      { question: '문서 버전', answer: MISSING_MARKER },
    ] },
    { fileName: 'B.hwpx', items: [
      { question: '서식 버전', answer: MISSING_MARKER },
      { question: '연구 목적', answer: MISSING_MARKER },
    ] },
  ],
  rawText: '',
}

const req = (body: unknown) =>
  ({ json: async () => body, headers: new Headers() }) as unknown as Parameters<typeof PATCH>[0]

beforeEach(() => {
  generateText.mockReset()
  state.updated = null
  state.createdMany = null
  state.project = {
    id: 'p1',
    formDraftJson: JSON.stringify(structure),
    draftOutputJson: JSON.stringify(output),
    userInputJson: JSON.stringify({ userAnswers: { q_0: '제목' }, naturalLanguageInput: '원래 입력한 자연어 설명' }),
  }
})

describe('PATCH /api/ai/irb-form-draft (보충 입력 → 병합 → 누락만 재생성)', () => {
  it('같은 정보를 쓰는 모든 파일의 누락 문항만 AI로 재생성하고, 나머지는 보존하며, 입력을 저장한다', async () => {
    // AI 응답: 호출된 프롬프트의 파일명에 맞춰 답을 돌려준다
    generateText.mockImplementation(async ({ messages }: { messages: { content: string }[] }) => {
      const prompt = messages[0].content
      if (prompt.includes('[파일: A.hwpx]')) return '[파일: A.hwpx]\n[문항] 문서 버전\n[답변] v2.0'
      if (prompt.includes('[파일: B.hwpx]')) return '[파일: B.hwpx]\n[문항] 서식 버전\n[답변] v2.0'
      return ''
    })

    const res = await PATCH(req({ projectId: 'p1', supplements: [{ answerKey: 'q_1', supplement: '버전은 2.0' }] }))
    expect(res.status).toBe(200)
    const out = await res.json()

    // 두 문서의 "버전" 항목이 모두 채워짐 (같은 answerKey 전파)
    expect(out.sections[0].items[1].answer).toBe('v2.0')
    expect(out.sections[1].items[0].answer).toBe('v2.0')
    // 보충 입력과 무관한 항목은 그대로: 사용자가 고친 답 / 다른 누락 항목
    expect(out.sections[0].items[0].answer).toBe('사용자가 직접 고친 제목')
    expect(out.sections[1].items[1].answer).toBe(MISSING_MARKER)

    // AI 호출은 대상이 있는 파일 2번뿐, 그리고 프롬프트에 병합된 입력/자연어가 다시 전달됨
    expect(generateText).toHaveBeenCalledTimes(2)
    const prompt = generateText.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('버전은 2.0')
    expect(prompt).toContain('원래 입력한 자연어 설명')
    expect(prompt).not.toContain('연구 목적')   // 대상이 아닌 문항은 프롬프트에도 없음

    // 저장: 출력 + 병합된 사용자 입력 (구조 컬럼은 건드리지 않음)
    expect(JSON.parse(state.updated!.userInputJson as string)).toEqual({
      userAnswers: { q_0: '제목', q_1: '버전은 2.0' },
      naturalLanguageInput: '원래 입력한 자연어 설명',
    })
    expect(JSON.parse(state.updated!.draftOutputJson as string).sections[0].items[0].answer).toBe('사용자가 직접 고친 제목')
    expect(state.updated).not.toHaveProperty('formDraftJson')
  })

  it('AI가 엉뚱하게 응답해도 입력값이 안전망으로 쓰이고 다른 항목은 건드리지 않는다', async () => {
    generateText.mockResolvedValue('죄송합니다 응답 형식 오류')
    const res = await PATCH(req({ projectId: 'p1', supplements: [{ answerKey: 'q_2', supplement: '진단 정확도 향상' }] }))
    const out = await res.json()
    expect(out.sections[1].items[1].answer).toBe('진단 정확도 향상')
    expect(out.sections[1].items[0].answer).toBe(MISSING_MARKER)
    expect(out.sections[0].items[0].answer).toBe('사용자가 직접 고친 제목')
  })

  it('예전 프로젝트(formDraftJson 에 Output 이 덮어써진 형태)도 보완할 수 있다', async () => {
    state.project = { id: 'p1', formDraftJson: JSON.stringify(output), draftOutputJson: null, userInputJson: null }
    generateText.mockResolvedValue('죄송합니다 응답 형식 오류')
    // legacy 에서는 문항 텍스트가 같으면 같은 키(k_n)로 유도된다. 키는 응답으로부터 알 수 없으므로 q:: 형태 사용 불가 →
    // 유도된 구조의 키 순서: 연구 제목=k_0, 문서 버전=k_1, 서식 버전=k_2, 연구 목적=k_3
    const res = await PATCH(req({ projectId: 'p1', supplements: [{ answerKey: 'k_3', supplement: '목적 내용' }] }))
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.sections[1].items[1].answer).toBe('목적 내용')
  })

  it('supplements 가 비어 있으면 400', async () => {
    const res = await PATCH(req({ projectId: 'p1', supplements: [] }))
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/projects/:id/draft (답변 직접 수정)', () => {
  it('지정한 문항만 교체하고 나머지는 그대로 둔다', async () => {
    const res = await PUT(req({ fileName: 'A.hwpx', question: '문서 버전', answer: ' 직접 입력 ' }), {
      params: { id: 'p1' },
    })
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.sections[0].items[1].answer).toBe('직접 입력')
    expect(out.sections[0].items[0].answer).toBe('사용자가 직접 고친 제목')
    expect(out.sections[1].items[0].answer).toBe(MISSING_MARKER)
    expect(JSON.parse(state.updated!.draftOutputJson as string).sections[0].items[1].answer).toBe('직접 입력')
  })
})

describe('POST /api/ai/irb-form-draft (생성 후 저장)', () => {
  it('문항 구조를 덮어쓰지 않고 구조·출력·사용자 입력을 각각 저장한다', async () => {
    generateText.mockResolvedValue(
      ['[파일: A.hwpx]', '[문항] 연구 제목', '[답변] 제목', '[문항] 문서 버전', `[답변] ${MISSING_MARKER}`].join('\n'),
    )
    const body = {
      projectId: 'p1',
      fileSections: [structure.fileSections[0]],
      mergedQuestions: structure.questions,
      userAnswers: { q_0: '제목' },
      naturalLanguageInput: '자연어 설명',
    }
    const r = {
      json: async () => body,
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Parameters<typeof POST>[0]
    const res = await POST(r)
    expect(res.status).toBe(200)

    const saved = state.createdMany!
    // 구조는 그대로 보존 (예전에는 여기에 Output 이 덮어써졌음)
    expect(JSON.parse(saved.formDraftJson as string)).toEqual({
      questions: structure.questions,
      fileSections: [structure.fileSections[0]],
    })
    expect(JSON.parse(saved.draftOutputJson as string).sections[0].items[0].answer).toBe('제목')
    expect(JSON.parse(saved.userInputJson as string)).toEqual({
      userAnswers: { q_0: '제목' },
      naturalLanguageInput: '자연어 설명',
    })
  })
})

describe('프로젝트 컨텍스트 (sourceSummary + 모듈 카드 내용) 프롬프트 주입', () => {
  const ctxProject = {
    sourceSummary: '요약본: 당뇨 환자 AI 진단 연구',
    modules: [
      { content: '대상자는 성인 300명', module: { name: '연구 대상자' } },
      { content: '   ', module: { name: '빈 모듈' } },
    ],
  }

  it('POST: 요약본과 모듈 내용이 프롬프트 최상단에 들어가고 Ground Truth 규칙이 포함된다', async () => {
    state.project = { ...ctxProject }
    generateText.mockResolvedValue('[파일: A.hwpx]\n[문항] 연구 제목\n[답변] 제목')
    const body = {
      projectId: 'p1',
      fileSections: [structure.fileSections[0]],
      mergedQuestions: structure.questions,
      userAnswers: { q_0: '제목' },
      naturalLanguageInput: '',
    }
    const res = await POST({
      json: async () => body,
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)
    const prompt = generateText.mock.calls[0][0].messages[0].content as string
    expect(prompt.startsWith('=== [프로젝트 컨텍스트')).toBe(true)
    expect(prompt).toContain('요약본: 당뇨 환자 AI 진단 연구')
    expect(prompt).toContain('■ 연구 대상자\n대상자는 성인 300명')
    expect(prompt).not.toContain('빈 모듈')
    expect(prompt).toContain('Ground Truth')
  })

  it('POST: 다른 입력이 없어도 컨텍스트가 있으면 생성할 수 있다', async () => {
    state.project = { ...ctxProject }
    generateText.mockResolvedValue('[파일: A.hwpx]\n[문항] 연구 제목\n[답변] 제목')
    const body = {
      projectId: 'p1',
      fileSections: [structure.fileSections[0]],
      mergedQuestions: structure.questions,
      userAnswers: {},
      naturalLanguageInput: '',
    }
    const res = await POST({
      json: async () => body,
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)
  })

  it('PATCH: 보완 재생성에도 컨텍스트가 전달된다', async () => {
    state.project = { ...(state.project ?? {}), ...ctxProject }
    state.project = {
      id: 'p1',
      formDraftJson: JSON.stringify(structure),
      draftOutputJson: JSON.stringify(output),
      userInputJson: null,
      ...ctxProject,
    }
    generateText.mockResolvedValue('죄송합니다')
    await PATCH(req({ projectId: 'p1', supplements: [{ answerKey: 'q_2', supplement: '목적' }] }))
    const prompt = generateText.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('요약본: 당뇨 환자 AI 진단 연구')
    expect(prompt).toContain('대상자는 성인 300명')
  })
})