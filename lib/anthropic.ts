import Anthropic from '@anthropic-ai/sdk'

const globalForAnthropic = globalThis as unknown as {
  anthropic: Anthropic | undefined
}

// AI_PROVIDER=luxia 일 때는 Anthropic 키가 없어도 import가 터지지 않도록 placeholder 사용
// (실제 호출은 ai-client.ts에서 Luxia로 분기되므로 이 인스턴스는 사용되지 않음)
export const anthropic =
  globalForAnthropic.anthropic ??
  new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'placeholder-not-used' })

if (process.env.NODE_ENV !== 'production') globalForAnthropic.anthropic = anthropic
