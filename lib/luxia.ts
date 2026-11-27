export interface LuxiaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const LUXIA_API_URL = 'https://bridge.luxiacloud.com/luxia/v1/chat'

/** 일시적 오류 시 재시도 횟수 (첫 호출 제외) */
export const LUXIA_MAX_RETRIES = 2
/** 재시도 전 대기 시간 */
export const LUXIA_RETRY_DELAY_MS = 2000

/** 재시도하면 나을 수 있는 서버 응답 */
const RETRYABLE_STATUS = new Set([502, 503, 504])
/** 재시도하면 나을 수 있는 네트워크 오류 코드 */
const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
])

class LuxiaHttpError extends Error {
  constructor(public status: number, body: string) {
    super(`Luxia API error ${status}: ${body}`)
  }
}

export function getLuxiaModel(): string {
  return process.env.LUXIA_MODEL ?? 'luxia3-llm-32b-0731'
}

/** fetch 의 네트워크 오류는 원인(cause)에 코드가 들어 있다: TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }) */
function isRetryable(e: unknown): boolean {
  if (e instanceof LuxiaHttpError) return RETRYABLE_STATUS.has(e.status)
  const err = e as { message?: string; code?: string; cause?: { code?: string; message?: string } } | null
  const codes = [err?.code, err?.cause?.code].filter(Boolean) as string[]
  if (codes.some((c) => RETRYABLE_CODES.has(c))) return true
  const msg = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`
  return /fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|network/i.test(msg)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function callLuxia(
  messages: LuxiaMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const apiKey = process.env.LUXIA_API_KEY
  if (!apiKey) throw new Error('LUXIA_API_KEY is not set')

  const body = JSON.stringify({
    model: getLuxiaModel(),
    messages,
    stream: false,
    temperature: options.temperature ?? 0.2,
    max_completion_tokens: options.maxTokens ?? 1024,
  })

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(LUXIA_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body,
      })
      if (!response.ok) throw new LuxiaHttpError(response.status, await response.text())
      const data = await response.json()
      return data.choices[0].message.content as string
    } catch (e) {
      if (attempt >= LUXIA_MAX_RETRIES || !isRetryable(e)) throw e
      console.warn(
        `[luxia] 일시적 오류로 재시도 ${attempt + 1}/${LUXIA_MAX_RETRIES} (${LUXIA_RETRY_DELAY_MS}ms 후):`,
        e instanceof Error ? e.message : e,
      )
      await sleep(LUXIA_RETRY_DELAY_MS)
    }
  }
}
