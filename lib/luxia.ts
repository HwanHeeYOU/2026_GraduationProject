export interface LuxiaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const LUXIA_API_URL = 'https://bridge.luxiacloud.com/luxia/v1/chat'

export function getLuxiaModel(): string {
  return process.env.LUXIA_MODEL ?? 'luxia3-llm-32b-0731'
}

export async function callLuxia(
  messages: LuxiaMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const apiKey = process.env.LUXIA_API_KEY
  if (!apiKey) throw new Error('LUXIA_API_KEY is not set')

  const response = await fetch(LUXIA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
    },
    body: JSON.stringify({
      model: getLuxiaModel(),
      messages,
      stream: false,
      temperature: options.temperature ?? 0.2,
      max_completion_tokens: options.maxTokens ?? 1024,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Luxia API error ${response.status}: ${text}`)
  }

  const data = await response.json()
  return data.choices[0].message.content as string
}
