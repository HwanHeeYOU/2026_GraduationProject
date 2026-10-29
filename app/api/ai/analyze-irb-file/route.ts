import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { anthropic } from '@/lib/anthropic'
import { generateText, isLuxiaProvider } from '@/lib/ai-client'
import type { ModuleRecommendation, NewModuleSuggestion } from '@/lib/irb/types'

export const maxDuration = 60

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

async function extractDocxText(buffer: Buffer): Promise<string | null> {
  try {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    const text = result.value?.trim()
    if (!text) {
      console.warn('[extractDocxText] mammoth returned empty text')
      return null
    }
    return text
  } catch (e) {
    console.error('[extractDocxText] failed:', e instanceof Error ? e.message : e)
    return null
  }
}

async function extractHwpText(buffer: Buffer): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { parse, TableControl } = await import('@hwp.js/parser') as any

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collectParagraphText = (paragraphs: any): string[] => {
      const lines: string[] = []
      for (const paragraph of Array.from(paragraphs) as any[]) {
        let line = ''
        for (const char of paragraph.chars) line += char.toString()
        line = line.trim()
        if (line) lines.push(line)

        for (const control of paragraph.controls ?? []) {
          if (control instanceof TableControl) {
            for (const cell of control.cells) {
              lines.push(...collectParagraphText(cell.paragraphs))
            }
          }
        }
      }
      return lines
    }

    const document = parse(buffer)
    const lines: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const section of document.sections as any[]) {
      lines.push(...collectParagraphText(section.paragraphs))
    }

    const result = lines.join('\n').trim()
    if (!result) {
      console.warn('[extractHwpText] parsed but got empty text — HWP version may be unsupported')
      return null
    }
    return result
  } catch (e) {
    console.error('[extractHwpText] failed:', e instanceof Error ? e.message : e)
    return null
  }
}

async function extractHwpxText(buffer: Buffer): Promise<string | null> {
  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buffer)

    const allFiles = Object.keys(zip.files)
    console.log('[extractHwpxText] zip entries:', allFiles.filter(n => n.endsWith('.xml')).slice(0, 10))

    // 다양한 네임스페이스 패턴 지원 (hp:t, hh:t, w:t 등)
    const sectionFiles = allFiles
      .filter((name) => /^Contents\/section\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const na = Number(a.match(/(\d+)/)?.[1] ?? 0)
        const nb = Number(b.match(/(\d+)/)?.[1] ?? 0)
        return na - nb
      })

    if (sectionFiles.length === 0) {
      // Contents/Section 대신 다른 경로일 수 있음
      const fallback = allFiles.filter((n) => n.toLowerCase().includes('section') && n.endsWith('.xml'))
      console.warn('[extractHwpxText] no Contents/section*.xml found, fallback candidates:', fallback)
      if (fallback.length === 0) return null
      sectionFiles.push(...fallback)
    }

    const texts: string[] = []
    for (const name of sectionFiles) {
      const xml = await zip.files[name].async('text')
      // hp:t, hh:t, w:t 등 다양한 텍스트 태그 패턴 처리
      const patterns = [
        /<(?:hp|hh|w):t[^>]*>([\s\S]*?)<\/(?:hp|hh|w):t>/g,
        /<t[^>]*>([\s\S]*?)<\/t>/g,
      ]
      let found = false
      for (const pattern of patterns) {
        const matches = Array.from(xml.matchAll(pattern))
        if (matches.length > 0) {
          for (const m of matches) {
            const decoded = m[1]
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&apos;/g, "'")
              .replace(/&amp;/g, '&')
              .trim()
            if (decoded) texts.push(decoded)
          }
          found = true
          break
        }
      }
      if (!found) {
        console.warn('[extractHwpxText] no text tags found in', name, '— xml snippet:', xml.slice(0, 300))
      }
    }

    const result = texts.join('\n').trim()
    if (!result) {
      console.warn('[extractHwpxText] parsed but got empty text')
      return null
    }
    return result
  } catch (e) {
    console.error('[extractHwpxText] failed:', e instanceof Error ? e.message : e)
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
  modules: { id: string; name: string; description: string; category: string }[],
  extraText?: string
): string {
  const moduleList = modules
    .map((m) => `- ID: ${m.id} / 이름: ${m.name} / 설명: ${m.description} / 카테고리: ${m.category}`)
    .join('\n')

  const extraSection = extraText
    ? `\n=== 추가로 첨부된 문서 내용 ===\n${extraText.slice(0, 8000)}\n`
    : ''

  return `당신은 IRB(기관생명윤리위원회) 심의 서류 분석 전문가입니다.
위 PDF 문서를 분석하여, 제공된 IRB 모듈 목록 중 이 양식·가이드라인에서 필요로 하는 항목을 판단해주세요.
${extraSection}
${buildInstruction(moduleList)}`
}

function buildInstruction(moduleList: string): string {
  return `=== 사용 가능한 IRB 모듈 목록 ===
${moduleList}

다음 JSON 객체 형식으로만 응답해주세요. 다른 텍스트나 마크다운은 절대 포함하지 마세요:
{
  "summary": "문서에 실제로 담긴 연구 목적, 연구 대상, 연구 방법·절차, 수집 데이터 등 핵심 내용을 3~5문장의 한국어로 요약",
  "items": [
    {
      "type": "matched",
      "moduleId": "module-01",
      "status": "required",
      "reason": "업로드한 양식에서 '연구 목적' 항목이 명시적으로 요구됩니다.",
      "matchedSection": "양식 1항: 연구 목적 및 필요성"
    },
    {
      "type": "new",
      "suggestedName": "유전자 정보 활용 동의",
      "suggestedCategory": "동의서",
      "suggestedDescription": "유전자 정보를 수집·활용하는 연구에서 별도로 받아야 하는 동의 항목",
      "status": "required",
      "reason": "위 목록의 어떤 모듈로도 표현되지 않는 항목을 이 양식이 명시적으로 요구합니다.",
      "matchedSection": "양식 3항: 유전자 정보 활용 동의"
    }
  ]
}

규칙:
- "summary"는 문서에 실제로 있는 내용만 근거로 작성하고, 문서에 없는 내용은 지어내지 마세요. 문서가 양식/가이드라인일 뿐 연구 내용이 담겨있지 않다면 빈 문자열로 두세요
- "items"의 "type": "matched"는 위 모듈 목록 중 하나와 대응될 때 사용하고, "type": "new"는 위 목록에 있는 모든 항목과 이름이나 의미가 명확히 다른 완전히 새로운 요구사항을 발견했을 때만 사용하세요
- "matched"인 경우 moduleId는 반드시 위 목록에 있는 ID만 사용하고 suggested* 필드는 생략하세요
- "new"인 경우 moduleId는 생략하고 suggestedName/suggestedCategory/suggestedDescription을 채우세요
- "new"의 suggestedName은 위 모듈 목록에 이미 존재하는 이름(또는 그 이름의 일부)과 같거나 유사한 이름을 절대 사용하지 마세요. 위 목록에 이미 있는 개념이라면 반드시 "matched"로 처리하세요
- "required": 문서에서 해당 항목을 명시적으로 요구하는 경우
- "recommended": 문서 내용으로 미루어 작성이 권장되는 경우
- 관련 없는 항목은 "items"에 포함하지 마세요
- 유효한 JSON 객체만 반환하세요`
}

interface RawAnalysisItem {
  type?: 'matched' | 'new'
  moduleId?: string
  status: 'required' | 'recommended'
  reason: string
  matchedSection: string
  suggestedName?: string
  suggestedDescription?: string
  suggestedCategory?: string
}

function parseAnalysisResult(raw: string): {
  matched: ModuleRecommendation[]
  newSuggestions: NewModuleSuggestion[]
  summary: string
} {
  // Handle both bare JSON and markdown code blocks
  const match = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ?? raw.match(/(\{[\s\S]*\})/)
  if (!match) {
    console.warn('[analyze-irb-file] no JSON object in response, raw (first 300):', raw.slice(0, 300))
    return { matched: [], newSuggestions: [], summary: '' }
  }

  let parsed: { summary?: string; items?: RawAnalysisItem[] }
  try {
    parsed = JSON.parse(match[1] ?? match[0])
  } catch (e) {
    // JSON이 잘린 경우 — items 배열까지만 복구 시도
    console.warn('[analyze-irb-file] JSON parse failed (likely truncated):', e instanceof Error ? e.message : e)
    const rawJson = match[1] ?? match[0]
    // 마지막으로 완성된 객체까지만 잘라서 재시도
    try {
      const lastCompleteItem = rawJson.lastIndexOf('},')
      if (lastCompleteItem > 0) {
        const truncated = rawJson.slice(0, lastCompleteItem + 1) + ']}}'
        parsed = JSON.parse(truncated)
        console.log('[analyze-irb-file] recovered truncated JSON, items:', (parsed.items ?? []).length)
      } else {
        return { matched: [], newSuggestions: [], summary: '' }
      }
    } catch {
      return { matched: [], newSuggestions: [], summary: '' }
    }
  }

  const items: RawAnalysisItem[] = parsed.items ?? []

  const matched: ModuleRecommendation[] = []
  const newSuggestions: NewModuleSuggestion[] = []

  for (const item of items) {
    if (item.type === 'new' || (!item.moduleId && item.suggestedName)) {
      if (!item.suggestedName) continue
      newSuggestions.push({
        suggestedName: item.suggestedName,
        suggestedDescription: item.suggestedDescription ?? '',
        suggestedCategory: item.suggestedCategory ?? '기타',
        status: item.status,
        reason: item.reason,
        matchedSection: item.matchedSection,
      })
    } else if (item.moduleId) {
      matched.push({
        moduleId: item.moduleId,
        status: item.status,
        reason: item.reason,
        matchedSection: item.matchedSection,
      })
    }
  }

  return { matched, newSuggestions, summary: parsed.summary?.trim() ?? '' }
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

  const files = formData.getAll('file').filter((f): f is File => f instanceof File)
  const institutionId = formData.get('institutionId') as string | null

  if (files.length === 0 || !institutionId) {
    return NextResponse.json({ error: 'BadRequest', message: '파일과 기관 ID가 필요합니다.' }, { status: 400 })
  }

  const SUPPORTED_EXTS = ['pdf', 'docx', 'txt', 'hwp', 'hwpx']
  for (const f of files) {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (!SUPPORTED_EXTS.includes(ext)) {
      return NextResponse.json(
        { error: 'UnsupportedFormat', message: 'PDF, DOCX, TXT, HWP, HWPX 파일만 지원합니다.' },
        { status: 400 }
      )
    }
    if (f.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'FileTooLarge', message: '파일 크기는 10MB 이하여야 합니다.' },
        { status: 400 }
      )
    }
  }

  const entries = await Promise.all(
    files.map(async (f) => ({
      name: f.name,
      ext: f.name.split('.').pop()?.toLowerCase() ?? '',
      buffer: Buffer.from(await f.arrayBuffer()),
    }))
  )

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
    const pdfEntries = entries.filter((e) => e.ext === 'pdf')
    const textEntries = entries.filter((e) => e.ext !== 'pdf')

    const extractedTexts: string[] = []
    for (const entry of textEntries) {
      let text: string | null = null
      if (entry.ext === 'txt') {
        text = entry.buffer.toString('utf-8').trim() || null
      } else if (entry.ext === 'docx') {
        text = await extractDocxText(entry.buffer)
      } else if (entry.ext === 'hwp') {
        text = await extractHwpText(entry.buffer)
      } else if (entry.ext === 'hwpx') {
        text = await extractHwpxText(entry.buffer)
      }
      if (text) {
        console.log(`[analyze-irb-file] extracted ${text.length} chars from ${entry.name}`)
        extractedTexts.push(`=== 파일: ${entry.name} ===\n${text}`)
      } else {
        console.warn(`[analyze-irb-file] failed to extract text from ${entry.name} (ext: ${entry.ext})`)
      }
    }

    if (pdfEntries.length === 0 && extractedTexts.length === 0) {
      return NextResponse.json(
        { error: 'ParseError', message: '첨부한 파일에서 텍스트를 읽을 수 없습니다. 다른 형식으로 변환 후 시도해 주세요.' },
        { status: 422 }
      )
    }

    const combinedText = extractedTexts.join('\n\n')
    let rawText: string

    if (pdfEntries.length > 0) {
      if (isLuxiaProvider()) {
        return NextResponse.json(
          { error: 'UnsupportedFormat', message: 'PDF 파일 분석은 Anthropic 제공자에서만 지원됩니다. AI_PROVIDER=anthropic으로 변경하거나 TXT/DOCX/HWP 파일을 사용해 주세요.' },
          { status: 422 }
        )
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content: any[] = pdfEntries.map((entry) => ({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: entry.buffer.toString('base64'),
        },
      }))
      content.push({ type: 'text', text: buildPdfInstruction(moduleList, combinedText || undefined) })

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content }] as any,
      })
      rawText = response.content[0]?.type === 'text' ? response.content[0].text : ''
    } else {
      rawText = await generateText({
        messages: [{ role: 'user', content: buildTextPrompt(combinedText, moduleList) }],
        maxTokens: 4096,
      })
    }
    const { matched, newSuggestions, summary } = parseAnalysisResult(rawText)

    // Filter out any invalid moduleIds that aren't in our list
    const validIds = new Set(moduleList.map((m) => m.id))
    const filtered = matched.filter((r) => validIds.has(r.moduleId))

    console.log(
      '[analyze-irb-file] recommendations:', filtered.length,
      'newSuggestions:', newSuggestions.length,
      'summaryLength:', summary.length,
      'for institution:', institutionId
    )
    return NextResponse.json({ recommendations: filtered, newSuggestions, summary })
  } catch (error) {
    console.error('[analyze-irb-file] error:', error)
    return NextResponse.json(
      { error: 'InternalServerError', message: '파일 분석에 실패했습니다. 기존 모듈 목록을 사용해 주세요.' },
      { status: 500 }
    )
  }
}
