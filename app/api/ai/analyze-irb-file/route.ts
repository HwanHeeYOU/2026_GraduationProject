import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { anthropic } from '@/lib/anthropic'
import { generateText, isLuxiaProvider } from '@/lib/ai-client'
import type { ModuleRecommendation } from '@/lib/irb/types'

export const maxDuration = 60

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

async function extractDocxText(buffer: Buffer): Promise<string | null> {
  try {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value?.trim() || null
  } catch {
    return null
  }
}

function buildTextPrompt(
  documentText: string,
  modules: { id: string; name: string; description: string; category: string }[]
): string {
  const moduleList = modules
    .map((m) => `- ID: ${m.id} / 이름: ${m.name} / 설명: ${m.description} / 카테고리: ${m.category}`)
    .join('\n')

  return `당신은 IRB(기관생명윤리위원회) 심의 서류 분석 전문가입니다.
아래 문서를 분석하여, 제공된 IRB 모듈 목록 중 이 양식·가이드라인에서 필요로 하는 항목을 판단해주세요.

=== 문서 내용 ===
${documentText.slice(0, 8000)}

${buildInstruction(moduleList)}`
}

function buildPdfInstruction(
  modules: { id: string; name: string; description: string; category: string }[]
): string {
  const moduleList = modules
    .map((m) => `- ID: ${m.id} / 이름: ${m.name} / 설명: ${m.description} / 카테고리: ${m.category}`)
    .join('\n')

  return `당신은 IRB(기관생명윤리위원회) 심의 서류 분석 전문가입니다.
위 PDF 문서를 분석하여, 제공된 IRB 모듈 목록 중 이 양식·가이드라인에서 필요로 하는 항목을 판단해주세요.

${buildInstruction(moduleList)}`
}

function buildInstruction(moduleList: string): string {
  return `=== 사용 가능한 IRB 모듈 목록 ===
${moduleList}

다음 JSON 배열 형식으로만 응답해주세요. 다른 텍스트나 마크다운은 절대 포함하지 마세요:
[
  {
    "moduleId": "module-01",
    "status": "required",
    "reason": "업로드한 양식에서 '연구 목적' 항목이 명시적으로 요구됩니다.",
    "matchedSection": "양식 1항: 연구 목적 및 필요성"
  }
]

규칙:
- "required": 문서에서 해당 항목을 명시적으로 요구하는 경우
- "recommended": 문서 내용으로 미루어 작성이 권장되는 경우
- 관련 없는 모듈은 포함하지 마세요
- moduleId는 반드시 위 목록에 있는 ID만 사용하세요
- 유효한 JSON 배열만 반환하세요`
}

function parseRecommendations(raw: string): ModuleRecommendation[] {
  // Handle both bare JSON and markdown code blocks
  const match = raw.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/) ?? raw.match(/(\[[\s\S]*\])/)
  if (!match) throw new Error('No JSON array in response')
  return JSON.parse(match[1] ?? match[0])
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '로그인이 필요합니다.' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const institutionId = formData.get('institutionId') as string | null

  if (!file || !institutionId) {
    return NextResponse.json({ error: 'BadRequest', message: '파일과 기관 ID가 필요합니다.' }, { status: 400 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!['pdf', 'docx', 'txt'].includes(ext)) {
    return NextResponse.json(
      { error: 'UnsupportedFormat', message: 'PDF, DOCX, TXT 파일만 지원합니다.' },
      { status: 400 }
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: 'FileTooLarge', message: '파일 크기는 10MB 이하여야 합니다.' },
      { status: 400 }
    )
  }

  const institutionModules = await prisma.institutionModule.findMany({
    where: { institutionId },
    include: { module: true },
    orderBy: { priority: 'asc' },
  })

  if (institutionModules.length === 0) {
    return NextResponse.json({ error: 'NotFound', message: '기관 정보를 찾을 수 없습니다.' }, { status: 404 })
  }

  const moduleList = institutionModules.map((im) => ({
    id: im.module.id,
    name: im.module.name,
    description: im.module.description,
    category: im.module.category,
  }))

  try {
    let rawText: string

    if (ext === 'txt') {
      const text = buffer.toString('utf-8')
      rawText = await generateText({
        messages: [{ role: 'user', content: buildTextPrompt(text, moduleList) }],
        maxTokens: 2048,
      })
    } else if (ext === 'pdf') {
      if (isLuxiaProvider()) {
        return NextResponse.json(
          { error: 'UnsupportedFormat', message: 'PDF 파일 분석은 Anthropic 제공자에서만 지원됩니다. AI_PROVIDER=anthropic으로 변경하거나 TXT/DOCX 파일을 사용해 주세요.' },
          { status: 422 }
        )
      }
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: buffer.toString('base64'),
                },
              },
              { type: 'text', text: buildPdfInstruction(moduleList) },
            ],
          },
        ],
      })
      rawText = response.content[0]?.type === 'text' ? response.content[0].text : ''
    } else {
      // DOCX
      const text = await extractDocxText(buffer)
      if (!text) {
        return NextResponse.json(
          { error: 'ParseError', message: 'DOCX 파일을 읽을 수 없습니다. PDF 또는 TXT 형식으로 변환 후 시도해 주세요.' },
          { status: 422 }
        )
      }
      rawText = await generateText({
        messages: [{ role: 'user', content: buildTextPrompt(text, moduleList) }],
        maxTokens: 2048,
      })
    }
    const recommendations = parseRecommendations(rawText)

    // Filter out any invalid moduleIds that aren't in our list
    const validIds = new Set(moduleList.map((m) => m.id))
    const filtered = recommendations.filter((r) => validIds.has(r.moduleId))

    console.log('[analyze-irb-file] recommendations:', filtered.length, 'for institution:', institutionId)
    return NextResponse.json({ recommendations: filtered })
  } catch (error) {
    console.error('[analyze-irb-file] error:', error)
    return NextResponse.json(
      { error: 'InternalServerError', message: '파일 분석에 실패했습니다. 기존 모듈 목록을 사용해 주세요.' },
      { status: 500 }
    )
  }
}
