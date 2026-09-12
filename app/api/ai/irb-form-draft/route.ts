import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { generateText } from '@/lib/ai-client'
import type { IRBFormDraftResult, IRBFormDraftOutput } from '@/lib/irb/types'

export const maxDuration = 60

const MAX_FILE_SIZE = 10 * 1024 * 1024

// ── 파일 텍스트 추출 ──────────────────────────────────────────
async function extractText(name: string, buffer: Buffer): Promise<string | null> {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''

  if (ext === 'txt') return buffer.toString('utf-8').trim() || null

  if (ext === 'docx') {
    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      return result.value?.trim() || null
    } catch { return null }
  }

  if (ext === 'hwp') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { parse, TableControl } = await import('@hwp.js/parser') as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const collect = (paragraphs: any): string[] => {
        const lines: string[] = []
        for (const p of Array.from(paragraphs) as any[]) {
          let line = ''; for (const c of p.chars) line += c.toString()
          if (line.trim()) lines.push(line.trim())
          for (const ctrl of p.controls ?? [])
            if (ctrl instanceof TableControl)
              for (const cell of ctrl.cells) lines.push(...collect(cell.paragraphs))
        }
        return lines
      }
      const doc = parse(buffer)
      const lines: string[] = []
      for (const sec of doc.sections as any[]) lines.push(...collect(sec.paragraphs))
      return lines.join('\n').trim() || null
    } catch { return null }
  }

  if (ext === 'hwpx') {
    try {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(buffer)
      const secs = Object.keys(zip.files)
        .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
        .sort((a, b) => Number(a.match(/(\d+)/)?.[1]) - Number(b.match(/(\d+)/)?.[1]))
      const texts: string[] = []
      for (const n of secs) {
        const xml = await zip.files[n].async('text')
        for (const m of xml.matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g)) {
          const d = m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&')
          if (d) texts.push(d)
        }
      }
      return texts.join('\n').trim() || null
    } catch { return null }
  }

  return null
}

// ── Step 1 프롬프트: 파일 분석 → 문항 추출 + 통합 ─────────────
function buildExtractionPrompt(files: { name: string; text: string }[]): string {
  const fileBlocks = files
    .map((f) => `=== 파일: ${f.name} ===\n${f.text.slice(0, 6000)}`)
    .join('\n\n')

  return `당신은 IRB(기관생명윤리위원회) 서류 분석 전문가입니다.
아래 ${files.length}개의 IRB 서류 파일을 분석하여, 각 파일에서 사용자에게 입력을 요청해야 할 문항들을 추출하고 중복을 통합하세요.

${fileBlocks}

분석 지침:
1. 각 파일에서 빈칸으로 채워야 할 문항(연구제목, 연구자 정보, 연구 내용 등)을 모두 추출하세요.
2. 여러 파일에서 동일하거나 유사한 정보를 요구하는 문항은 하나로 통합하세요 (예: 여러 파일의 "연구자 성명" → 통합 질문 1개).
3. 각 통합 질문에는 고유한 영문 snake_case key를 부여하세요.
4. 파일별로 어떤 통합 질문의 답변이 필요한지 매핑하세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트나 마크다운 없이 순수 JSON만 반환하세요:
{
  "questions": [
    {
      "key": "research_title",
      "label": "연구 제목",
      "placeholder": "예: False Memory 연구를 위한 Stroop Task 실험",
      "multiline": false
    },
    {
      "key": "researcher_name",
      "label": "연구책임자 성명",
      "placeholder": "예: 홍길동",
      "multiline": false
    },
    {
      "key": "research_background",
      "label": "연구 배경 및 목적",
      "placeholder": "연구의 배경, 필요성, 목적을 설명해주세요",
      "multiline": true
    }
  ],
  "fileSections": [
    {
      "fileName": "연구계획 요약서.docx",
      "items": [
        { "question": "연구 제목", "answerKey": "research_title" },
        { "question": "연구책임자 성명", "answerKey": "researcher_name" },
        { "question": "연구 배경 및 목적", "answerKey": "research_background" }
      ]
    },
    {
      "fileName": "연구비 산정내역서.docx",
      "items": [
        { "question": "연구 제목", "answerKey": "research_title" },
        { "question": "연구책임자 성명", "answerKey": "researcher_name" }
      ]
    }
  ]
}`
}

// ── Step 2 프롬프트: 답변 → 파일별 초안 생성 ─────────────────
function buildGenerationPrompt(
  fileSections: IRBFormDraftResult['fileSections'],
  answers: Record<string, string>
): string {
  const answerBlock = Object.entries(answers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

  const sectionDescs = fileSections
    .map((f) => {
      const items = f.items.map((i) => `  - [문항] ${i.question} (key: ${i.answerKey})`).join('\n')
      return `파일명: ${f.fileName}\n${items}`
    })
    .join('\n\n')

  return `당신은 IRB 서류 작성 전문가입니다. 아래 연구자 답변을 바탕으로 각 서류 파일의 문항별 초안 텍스트를 생성해주세요.

=== 연구자 답변 ===
${answerBlock}

=== 파일별 문항 목록 ===
${sectionDescs}

출력 규칙 (반드시 준수):
- 파일 수(${fileSections.length}개)만큼 섹션을 반복하세요
- 인사말, 부가 설명, 마크다운 없이 아래 형식만 사용하세요
- 각 [답변]은 IRB 서류에 바로 붙여넣을 수 있는 전문적 한국어 문장으로 작성하세요
- 답변 키에 해당하는 사용자 입력이 있으면 그 내용을 바탕으로, 없으면 일반적인 IRB 문구를 생성하세요

출력 형식:
[파일: 파일명1]
[문항] 문항내용1
[답변] 생성된 텍스트1
[문항] 문항내용2
[답변] 생성된 텍스트2

[파일: 파일명2]
[문항] 문항내용1
[답변] 생성된 텍스트1`
}

// ── 결과 텍스트 파싱 ──────────────────────────────────────────
function parseOutput(raw: string): IRBFormDraftOutput['sections'] {
  const sections: IRBFormDraftOutput['sections'] = []
  const fileBlocks = raw.split(/\[파일:\s*(.+?)\]/).slice(1)

  for (let i = 0; i < fileBlocks.length; i += 2) {
    const fileName = (fileBlocks[i] ?? '').trim()
    const body = fileBlocks[i + 1] ?? ''
    const items: { question: string; answer: string }[] = []

    const parts = body.split(/\[문항\]/).slice(1)
    for (const part of parts) {
      const [questionPart, ...answerParts] = part.split(/\[답변\]/)
      const question = (questionPart ?? '').trim()
      const answer = (answerParts.join('[답변]') ?? '').trim()
      if (question) items.push({ question, answer })
    }

    if (fileName) sections.push({ fileName, items })
  }

  return sections
}

// ── 메인 핸들러 ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '로그인이 필요합니다.' }, { status: 401 })
  }

  const contentType = req.headers.get('content-type') ?? ''

  // ── Phase 1: 파일 → 문항 추출 ──────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    let formData: FormData
    try { formData = await req.formData() }
    catch { return NextResponse.json({ error: 'BadRequest' }, { status: 400 }) }

    const files = formData.getAll('file').filter((f): f is File => f instanceof File)
    if (files.length === 0)
      return NextResponse.json({ error: 'BadRequest', message: '파일이 필요합니다.' }, { status: 400 })

    const SUPPORTED = ['pdf', 'docx', 'txt', 'hwp', 'hwpx']
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      if (!SUPPORTED.includes(ext))
        return NextResponse.json({ error: 'UnsupportedFormat', message: 'PDF, DOCX, TXT, HWP, HWPX만 지원합니다.' }, { status: 400 })
      if (f.size > MAX_FILE_SIZE)
        return NextResponse.json({ error: 'FileTooLarge', message: '파일당 최대 10MB입니다.' }, { status: 400 })
    }

    // PDF는 현재 텍스트 추출 미지원 → base64 변환 후 별도 처리
    const extracted: { name: string; text: string }[] = []
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      const buffer = Buffer.from(await f.arrayBuffer())

      if (ext === 'pdf') {
        // PDF: Anthropic vision API로 텍스트 추출
        try {
          const { anthropic } = await import('@/lib/anthropic')
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 2048,
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
                } as any,
                { type: 'text', text: '이 PDF 문서의 모든 텍스트를 그대로 추출해주세요. 양식 레이아웃과 문항 구조를 최대한 보존하세요.' },
              ],
            }] as any,
          })
          const text = response.content[0]?.type === 'text' ? response.content[0].text : null
          if (text) extracted.push({ name: f.name, text })
        } catch {
          // PDF 추출 실패 시 스킵
        }
      } else {
        const text = await extractText(f.name, buffer)
        if (text) extracted.push({ name: f.name, text })
      }
    }

    if (extracted.length === 0)
      return NextResponse.json({ error: 'ParseError', message: '파일에서 텍스트를 읽을 수 없습니다.' }, { status: 422 })

    try {
      const raw = await generateText({
        messages: [{ role: 'user', content: buildExtractionPrompt(extracted) }],
        maxTokens: 3000,
      })

      // JSON 파싱
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in response')
      const result: IRBFormDraftResult = JSON.parse(jsonMatch[0])

      return NextResponse.json(result)
    } catch (e) {
      console.error('[irb-form-draft] extraction error:', e)
      return NextResponse.json({ error: 'InternalServerError', message: '문항 추출에 실패했습니다.' }, { status: 500 })
    }
  }

  // ── Phase 2: 답변 → 초안 생성 ─────────────────────────────
  if (contentType.includes('application/json')) {
    let body: { fileSections: IRBFormDraftResult['fileSections']; answers: Record<string, string> }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: 'BadRequest' }, { status: 400 }) }

    const { fileSections, answers } = body
    if (!fileSections?.length || !answers)
      return NextResponse.json({ error: 'BadRequest', message: 'fileSections와 answers가 필요합니다.' }, { status: 400 })

    try {
      const raw = await generateText({
        messages: [{ role: 'user', content: buildGenerationPrompt(fileSections, answers) }],
        maxTokens: 4000,
      })

      const sections = parseOutput(raw)

      // rawText: 복사용 전체 텍스트
      const rawText = sections
        .map((s) => {
          const items = s.items.map((i) => `[문항] ${i.question}\n[답변] ${i.answer}`).join('\n\n')
          return `[파일: ${s.fileName}]\n${items}`
        })
        .join('\n\n' + '─'.repeat(40) + '\n\n')

      return NextResponse.json({ sections, rawText } satisfies IRBFormDraftOutput)
    } catch (e) {
      console.error('[irb-form-draft] generation error:', e)
      return NextResponse.json({ error: 'InternalServerError', message: '초안 생성에 실패했습니다.' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'BadRequest' }, { status: 400 })
}
