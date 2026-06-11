import { anthropic } from './anthropic'
import { callLuxia, type LuxiaMessage } from './luxia'

export type AIMessage = { role: 'user' | 'assistant'; content: string }

interface GenerateTextOptions {
  messages: AIMessage[]
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
  anthropicModel?: string
}

export function getAIProvider(): string {
  return (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase()
}

export function isLuxiaProvider(): boolean {
  return getAIProvider() === 'luxia'
}

export async function generateText({
  messages,
  maxTokens = 1024,
  temperature,
  systemPrompt,
  anthropicModel = 'claude-sonnet-4-5',
}: GenerateTextOptions): Promise<string> {
  if (isLuxiaProvider()) {
    const luxiaMessages: LuxiaMessage[] = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      ...messages,
    ]
    return callLuxia(luxiaMessages, { maxTokens, temperature })
  }

  const response = await anthropic.messages.create({
    model: anthropicModel,
    max_tokens: maxTokens,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages,
  })
  const firstBlock = response.content[0]
  return firstBlock?.type === 'text' ? firstBlock.text : ''
}
