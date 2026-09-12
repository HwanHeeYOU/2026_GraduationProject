import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { generateText } from '@/lib/ai-client'
import type { IRBFormDraftResult, IRBFormDraftOutput } from '@/lib/irb/types'

export const maxDuration = 60

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MISSING_MARKER = '[작성 필요: 추가 정보 입력 요망]'

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

// ── Phase 1: 파일 하나에서 문항 추출 ─────────────────────────
function buildSingleExtractionPrompt(fileName: string, text: string): string {
  return `당신은 IRB(기관생명윤리위원회) 서류 분석 전문가입니다.
아래 IRB 서류 파일을 분석하여, 사용자가 작성해야 할 문항들을 빠짐없이 추출하세요.

=== 파일: ${fileName} ===
${text.slice(0, 8000)}

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트나 마크다운 코드블록 없이 순수 JSON만:
{
  "fileName": "${fileName}",
  "items": [
    { "question": "연구 제목" },
    { "question": "연구책임자 성명" },
    { "question": "연구 배경 및 목적" }
  ]
}`
}

// ── Phase 2: 파일 하나의 문항에 답변 생성 ─────────────────────
function buildSingleGenerationPrompt(
  fileName: string,
  questions: string[],
  researchDescription: string
): string {
  const questionList = questions.map((q, i) => `${i + 1}. ${q}`).join('\n')

  return `[시스템 지침 — 최우선 규칙]
당신은 IRB 서류 작성 전문가입니다. 아래 연구 설명에 기반해서만 답변을 작성하세요.

★ 환각(Hallucination) 엄금 ★
사용자가 제공한 연구 설명에 특정 문항을 채울 정보가 없다면, 절대로 임의의 텍스트나 가짜 데이터를 만들어내지 마세요.
정보가 없는 문항의 답변란에는 정확히 다음 텍스트만 출력하세요: ${MISSING_MARKER}

=== 연구 설명 ===
${researchDescription.slice(0, 6000)}

=== 파일: ${fileName} ===
아래 문항 ${questions.length}개에 대해 답변을 작성하세요:
${questionList}

출력 규칙 (반드시 준수):
- 인사말, 설명, 마크다운 없이 아래 형식만 출력
- 모든 ${questions.length}개 문항을 빠짐없이 포함할 것
- 연구 설명에 근거가 있는 경우에만 전문적 한국어 문장으로 작성
- 연구 설명에 정보가 없으면 반드시 "${MISSING_MARKER}" 만 출력

출력 형식:
[파일: ${fileName}]
[문항] 문항내용
[답변] 생성된 답변 또는 ${MISSING_MARKER}`
}

// ── 결과 텍스트 파싱 ──────────────────────────────────────────
function parseFileOutput(raw: string, fileName: string): { question: string; answer: string }[] {
  const items: { question: string; answer: string }[] = []
  const parts = raw.split(/\[문항\]/).slice(1)
  for (const part of parts) {
    const [questionPart, ...answerParts] = part.split(/\[답변\]/)
    const question = (questionPart ?? '').trim()
    const answer = (answerParts.join('[답변]') ?? '').trim()
    if (question) items.push({ question, answer })
  }
  return items
}

// ── 메인 핸들러 ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '로그인이 필요합니다.' }, { status: 401 })
  }

  const contentType = req.headers.get('content-type') ?? ''

  // ── Phase 1: 파일 → 문항 추출 (파일별 독립 호출) ───────────
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

    // 텍스트 추출
    const extracted: { name: string; text: string }[] = []
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      const buffer = Buffer.from(await f.arrayBuffer())
      if (ext === 'pdf') {
        try {
          const { anthropic } = await import('@/lib/anthropic')
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 2048,
            messages: [{ role: 'user', content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } } as any,
              { type: 'text', text: '이 PDF 문서의 모든 텍스트를 그대로 추출해주세요. 양식 구조를 보존하세요.' },
            ]}] as any,
          })
          const text = response.content[0]?.type === 'text' ? response.content[0].text : null
          if (text) extracted.push({ name: f.name, text })
        } catch { /* PDF 추출 실패 시 스킵 */ }
      } else {
        const text = await extractText(f.name, buffer)
        if (text) extracted.push({ name: f.name, text })
      }
    }

    if (extracted.length === 0)
      return NextResponse.json({ error: 'ParseError', message: '파일에서 텍스트를 읽을 수 없습니다.' }, { status: 422 })

    try {
      // 파일별로 순차 처리 (rate limit 방지)
      const perFileResults: { fileName: string; items: { question: string }[] }[] = []
      for (const f of extracted) {
        const raw = await generateText({
          messages: [{ role: 'user', content: buildSingleExtractionPrompt(f.name, f.text) }],
          maxTokens: 1500,
        })
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          perFileResults.push({ fileName: f.name, items: [] })
          continue
        }
        try {
          const parsed = JSON.parse(jsonMatch[0]) as { fileName: string; items: { question: string }[] }
          perFileResults.push({ fileName: f.name, items: parsed.items ?? [] })
        } catch {
          perFileResults.push({ fileName: f.name, items: [] })
        }
      }

      // 중복 질문 통합 (문항 텍스트 기준)
      const allQuestions = new Map<string, string>() // question → snake_key
      for (const file of perFileResults) {
        for (const item of file.items) {
          const q = item.question.trim()
          if (!q) continue
          if (!allQuestions.has(q)) {
            const key = q.replace(/[^a-zA-Z0-9가-힣]/g, '_').slice(0, 40)
            allQuestions.set(q, `q_${allQuestions.size}_${key}`)
          }
        }
      }

      const result: IRBFormDraftResult = {
        questions: Array.from(allQuestions.entries()).map(([label, key]) => ({
          key,
          label,
          placeholder: '',
          multiline: label.length > 15,
        })),
        fileSections: perFileResults.map((f) => ({
          fileName: f.fileName,
          items: f.items.map((item) => ({
            question: item.question,
            answerKey: allQuestions.get(item.question.trim()) ?? item.question,
          })),
        })),
      }

      return NextResponse.json(result)
    } catch (e) {
      console.error('[irb-form-draft] extraction error:', e)
      return NextResponse.json({ error: 'InternalServerError', message: '문항 추출에 실패했습니다.' }, { status: 500 })
    }
  }

  // ── Phase 2: 파일별 독립 AI 호출로 초안 생성 ─────────────────
  if (contentType.includes('application/json')) {
    let body: { fileSections: IRBFormDraftResult['fileSections']; researchDescription: string }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: 'BadRequest' }, { status: 400 }) }

    const { fileSections, researchDescription } = body
    if (!fileSections?.length || !researchDescription?.trim())
      return NextResponse.json({ error: 'BadRequest', message: 'fileSections와 researchDescription이 필요합니다.' }, { status: 400 })

    try {
      // 파일별로 순차 처리 (rate limit 방지)
      const perFileSections: IRBFormDraftOutput['sections'] = []
      for (const fileSection of fileSections) {
        const questions = fileSection.items.map((i) => i.question)
        const raw = await generateText({
          messages: [{ role: 'user', content: buildSingleGenerationPrompt(
            fileSection.fileName,
            questions,
            researchDescription
          )}],
          maxTokens: 2000,
        })
        const items = parseFileOutput(raw, fileSection.fileName)
        if (items.length === 0) {
          perFileSections.push({
            fileName: fileSection.fileName,
            items: questions.map((q) => ({ question: q, answer: MISSING_MARKER })),
          })
          continue
        }
        const parsedMap = new Map(items.map((i) => [i.question, i.answer]))
        perFileSections.push({
          fileName: fileSection.fileName,
          items: questions.map((q) => ({
            question: q,
            answer: parsedMap.get(q) ?? MISSING_MARKER,
          })),
        })
      }

      const rawText = perFileSections
        .map((s) => {
          const items = s.items.map((i) => `[문항] ${i.question}\n[답변] ${i.answer}`).join('\n\n')
          return `[파일: ${s.fileName}]\n${items}`
        })
        .join('\n\n' + '─'.repeat(40) + '\n\n')

      return NextResponse.json({ sections: perFileSections, rawText } satisfies IRBFormDraftOutput)
    } catch (e) {
      console.error('[irb-form-draft] generation error:', e)
      return NextResponse.json({ error: 'InternalServerError', message: '초안 생성에 실패했습니다.' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'BadRequest' }, { status: 400 })
}
