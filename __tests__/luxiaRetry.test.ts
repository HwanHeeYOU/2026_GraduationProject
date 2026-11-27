// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callLuxia } from '@/lib/luxia'
import { buildProjectContext, PROJECT_CONTEXT_MAX_CHARS } from '@/lib/irb/projectContext'

const ok = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 })
const netErr = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } })

describe('callLuxia 재시도', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.LUXIA_API_KEY = 'test'
    fetchMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const run = async (p: Promise<string>) => {
    const settled = p.then((v) => ({ v }), (e) => ({ e }))
    await vi.runAllTimersAsync()
    return settled as Promise<{ v?: string; e?: Error }>
  }

  it.each(['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET'])('네트워크 오류(%s)는 2초 후 재시도해 성공한다', async (code) => {
    fetchMock.mockRejectedValueOnce(netErr(code)).mockResolvedValueOnce(ok('답'))
    const r = await run(callLuxia([{ role: 'user', content: 'x' }]))
    expect(r.v).toBe('답')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([502, 503, 504])('%i 응답은 재시도한다', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response('busy', { status })).mockResolvedValueOnce(ok('답'))
    expect((await run(callLuxia([{ role: 'user', content: 'x' }]))).v).toBe('답')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('최대 2회까지만 재시도하고(총 3번 호출) 마지막 오류를 던진다', async () => {
    fetchMock.mockRejectedValue(netErr('ECONNRESET'))
    const r = await run(callLuxia([{ role: 'user', content: 'x' }]))
    expect(r.e?.message).toBe('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('재시도 사이에 2초를 기다린다', async () => {
    fetchMock.mockRejectedValueOnce(netErr('ECONNRESET')).mockResolvedValueOnce(ok('답'))
    const p = callLuxia([{ role: 'user', content: 'x' }])
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toBe('답')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([400, 401, 429, 500])('%i 응답은 재시도하지 않는다', async (status) => {
    fetchMock.mockResolvedValue(new Response('no', { status }))
    const r = await run(callLuxia([{ role: 'user', content: 'x' }]))
    expect(r.e?.message).toContain(`Luxia API error ${status}`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('buildProjectContext 길이 제한', () => {
  it('짧으면 요약본과 모듈 메모를 모두 그대로 넣는다', () => {
    const t = buildProjectContext({ sourceSummary: '요약', modules: [{ content: '메모', module: { name: 'A' } }] })
    expect(t).toBe('[문서 분석 요약본]\n요약\n\n[사용자가 모듈 카드에 직접 작성한 내용]\n■ A\n메모')
  })

  it('요약본이 길면 상한(8,000자)에 맞춰 요약본만 자르고 모듈 메모는 끝까지 넣는다', () => {
    const memo = '사용자 메모 끝부분까지 보존'
    const t = buildProjectContext({
      sourceSummary: '가'.repeat(20000),
      modules: [{ content: '나'.repeat(3000) + memo, module: { name: '연구 대상자' } }],
    })
    expect(t.length).toBeLessThanOrEqual(PROJECT_CONTEXT_MAX_CHARS)
    expect(t).toContain(memo)
    expect(t).toContain('…(이하 생략)')
  })

  it('모듈 메모만으로 상한을 넘어도 메모는 자르지 않고, 요약본을 뺀다', () => {
    const memo = '다'.repeat(9000) + '마지막 문장'
    const t = buildProjectContext({ sourceSummary: '요약본 내용', modules: [{ content: memo, module: { name: 'B' } }] })
    expect(t).toContain('마지막 문장')
    expect(t).not.toContain('요약본 내용')
  })
})
