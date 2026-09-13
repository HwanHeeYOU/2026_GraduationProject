import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateText, getAIProvider } from '@/lib/ai-client'
import { buildRevisionPrompt } from '@/lib/irb/buildPrompt'

export const maxDuration = 30

interface AIReviseRequest {
  projectId: string
  projectModuleId: string
  currentContent: string
  rejectionReason: string
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

  let body: AIReviseRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const { projectId, projectModuleId, currentContent, rejectionReason, moduleMetadata } = body

  if (!projectId || !projectModuleId || !rejectionReason?.trim() || !moduleMetadata) {
    return NextResponse.json({ error: 'BadRequest', message: '필수 파라미터가 누락되었습니다.' }, { status: 400 })
  }

  const projectModule = await prisma.projectModule.findFirst({
    where: { id: projectModuleId, projectId, project: { userId: session.user.id } },
  })

  if (!projectModule) {
    return NextResponse.json({ error: 'NotFound', message: '모듈을 찾을 수 없습니다.' }, { status: 404 })
  }

  const provider = getAIProvider()
  console.log('[ai/revise] req:', { projectId, projectModuleId, provider })

  const startTime = Date.now()

  try {
    const irbModule = await prisma.iRBModule.findUnique({
      where: { id: projectModule.moduleId },
      select: { promptHint: true },
    })

    const prompt = buildRevisionPrompt({
      moduleName: moduleMetadata.name,
      moduleDescription: moduleMetadata.description,
      moduleCategory: moduleMetadata.category,
      promptHint: irbModule?.promptHint,
      currentContent: currentContent ?? '',
      rejectionReason,
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    let content: string
    try {
      content = await Promise.race([
        generateText({
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 1024,
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('TIMEOUT')))
        }),
      ])

      clearTimeout(timeoutId)
    } catch (err) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.message === 'TIMEOUT') {
        console.log('[ai/revise] error:', { projectModuleId, error: 'timeout' })
        return NextResponse.json(
          { error: 'GatewayTimeout', message: 'AI 수정에 실패했습니다. 다시 시도해 주세요.' },
          { status: 504 }
        )
      }
      throw err
    }

    const durationMs = Date.now() - startTime
    console.log('[ai/revise] res:', { projectModuleId, contentLength: content.length, durationMs })

    return NextResponse.json({ content, projectModuleId, generatedAt: new Date().toISOString() })
  } catch (error) {
    console.log('[ai/revise] error:', { projectModuleId, error: String(error) })
    return NextResponse.json(
      { error: 'InternalServerError', message: 'AI 수정에 실패했습니다. 다시 시도해 주세요.' },
      { status: 500 }
    )
  }
}
