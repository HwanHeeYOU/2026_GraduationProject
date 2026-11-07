import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { generateText } from '@/lib/ai-client'

export const maxDuration = 60

// AI에 넘길 모듈 내용 상한 (긴 내용도 요약에 온전히 반영)
const MAX_INPUT_CHARS = 60000

interface SummarizeRequest {
  modules: { name: string; content: string }[]
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: SummarizeRequest
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'BadRequest' }, { status: 400 }) }

  const { modules } = body
  if (!modules?.length) {
    return NextResponse.json({ error: 'BadRequest', message: '모듈 내용이 필요합니다.' }, { status: 400 })
  }

  // 내용이 있는 모듈만 필터링
  const filled = modules.filter((m) => m.content.trim().length > 0)
  if (filled.length === 0) {
    return NextResponse.json({ summary: '' })
  }

  // 모듈 내용을 하나의 텍스트로 결합
  const moduleText = filled
    .map((m) => `[${m.name}]\n${m.content.trim()}`)
    .join('\n\n')

  const prompt = `아래는 연구자가 IRB 서류 각 항목에 직접 작성한 내용입니다. 이 내용을 바탕으로, IRB 서류 자동 초안 생성에 활용할 수 있는 연구 설명문을 작성해주세요.

작성된 IRB 항목 내용:
${moduleText.slice(0, MAX_INPUT_CHARS)}

요구사항:
- 연구자가 작성한 모든 정보를 최대한 포함하세요
- 연구 목적, 방법, 대상자, 절차, 윤리적 고려사항 등을 통합하여 서술하세요
- 마크다운 없이 자연스러운 한국어 단락으로 작성하세요
- 다른 IRB 서류 작성 시 참고할 수 있는 종합적인 연구 설명이 되도록 하세요`

  try {
    const summary = await generateText({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 3000,
    })
    return NextResponse.json({ summary })
  } catch (e) {
    console.error('[summarize-modules] error:', e)
    return NextResponse.json({ error: 'InternalServerError', message: '요약 생성에 실패했습니다.' }, { status: 500 })
  }
}
