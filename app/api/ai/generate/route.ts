import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { anthropic } from '@/lib/anthropic'
import { buildIRBPrompt } from '@/lib/irb/buildPrompt'

export const maxDuration = 30

interface AIGenerateRequest {
  projectId: string
  moduleId: string
  keywords: string
  moduleMetadata: {
    name: string
    description: string
    category: string
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '로그인이 필요합니다.' }, { status: 401 })
  }

  let body: AIGenerateRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const { projectId, moduleId, keywords, moduleMetadata } = body

  if (!projectId || !moduleId || !keywords || !moduleMetadata) {
    return NextResponse.json({ error: 'BadRequest', message: '필수 파라미터가 누락되었습니다.' }, { status: 400 })
  }

  const model = 'claude-sonnet-4-5'
  console.log('[ai/generate] req:', { projectId, moduleId, keywords, model })

  const startTime = Date.now()

  try {
    const irbModule = await prisma.iRBModule.findUnique({
      where: { id: moduleId },
      select: { promptHint: true },
    })

    const prompt = buildIRBPrompt({
      moduleName: moduleMetadata.name,
      moduleDescription: moduleMetadata.description,
      moduleCategory: moduleMetadata.category,
      promptHint: irbModule?.promptHint,
      keywords,
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    let content: string
    try {
      const response = await Promise.race([
        anthropic.messages.create({
          model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('TIMEOUT')))
        }),
      ])

      clearTimeout(timeoutId)
      const firstBlock = response.content[0]
      content = firstBlock.type === 'text' ? firstBlock.text : ''
    } catch (err) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.message === 'TIMEOUT') {
        console.log('[ai/generate] error:', { moduleId, error: 'timeout' })
        return NextResponse.json(
          { error: 'GatewayTimeout', message: 'AI 초안 생성에 실패했습니다. 다시 시도해 주세요.' },
          { status: 504 }
        )
      }
      throw err
    }

    const durationMs = Date.now() - startTime
    console.log('[ai/generate] res:', { moduleId, contentLength: content.length, durationMs })

    return NextResponse.json({ content, moduleId, generatedAt: new Date().toISOString() })
  } catch (error) {
    console.log('[ai/generate] error:', { moduleId, error: String(error) })
    return NextResponse.json(
      { error: 'InternalServerError', message: 'AI 초안 생성에 실패했습니다. 다시 시도해 주세요.' },
      { status: 500 }
    )
  }
}
