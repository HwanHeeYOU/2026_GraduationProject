import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateText, isLuxiaProvider } from '@/lib/ai-client'
import type { IRBFormDraftResult, IRBFormDraftOutput, IRBFormQuestion, IRBUserAnswers } from '@/lib/irb/types'

export const maxDuration = 120

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
          const d = m[1]
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
          if (d.trim()) texts.push(d.trim())
        }
      }
      return texts.join('\n').trim() || null
    } catch { return null }
  }
  return null
}

// ── Phase 1-A: 파일 하나에서 raw 문항 추출 ───────────────────
function buildRawExtractionPrompt(fileName: string, text: string): string {
  return `당신은 IRB(기관생명윤리위원회) 서류 분석 전문가입니다.
아래 IRB 서류/양식 파일을 정밀하게 분석하여, 사용자가 실제로 작성·입력해야 할 모든 문항을 누락 없이 추출하세요.

=== 파일: ${fileName} ===
${text.slice(0, 8000)}

추출 규칙:
- 빈칸, 입력란, 서술 요청, 체크박스 항목 등 사용자가 채워야 할 모든 항목 포함
- 섹션 제목이나 안내문(작성 방법 설명)은 제외
- 표 형태의 양식도 각 셀의 입력 항목을 문항으로 추출
- 문항 텍스트는 원본 언어 그대로 유지 (한국어라면 한국어로)

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트나 마크다운 없이 순수 JSON만:
{
  "fileName": "${fileName}",
  "items": [
    { "question": "연구 제목" },
    { "question": "연구책임자 성명" },
    { "question": "연구 배경 및 목적" }
  ]
}`
}

// ── Phase 1-B: LLM 기반 의미 중복 통합 ──────────────────────
function buildDeduplicationPrompt(
  perFileItems: { fileName: string; questions: string[] }[]
): string {
  const filesSummary = perFileItems
    .map((f) => {
      const qList = f.questions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')
      return `[파일: ${f.fileName}]\n${qList}`
    })
    .join('\n\n')

  return `당신은 IRB 서류 통합 전문가입니다.
아래는 여러 IRB 파일에서 추출한 문항 목록입니다. 의미가 같거나 유사한 문항들을 하나로 병합하여, 사용자가 한 번만 입력하면 되는 통합 질문 목록을 만드세요.

${filesSummary}

병합 규칙:
- 표현이 달라도 묻는 내용이 동일하면 반드시 하나로 통합 (예: "연구 제목", "과제명", "연구 과제 제목" → "연구 제목")
- 통합 문항의 label은 가장 포괄적이고 명확한 표현을 사용
- 완전히 다른 내용을 묻는 문항은 각각 별도 항목으로 유지
- 각 통합 문항이 원본에서 어떤 표현들을 합쳤는지 variants에 모두 기록

출력 후 각 원본 파일의 각 문항이 통합 목록의 어떤 key에 해당하는지 매핑도 제공하세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트나 마크다운 없이 순수 JSON만:
{
  "mergedQuestions": [
    {
      "key": "q_0",
      "label": "연구 제목",
      "multiline": false,
      "variants": ["연구 제목", "과제명", "연구 과제 제목"]
    },
    {
      "key": "q_1",
      "label": "연구책임자 성명",
      "multiline": false,
      "variants": ["연구책임자 성명", "연구자 이름"]
    }
  ],
  "fileMappings": [
    {
      "fileName": "파일명1.docx",
      "items": [
        { "originalQuestion": "연구 제목", "mergedKey": "q_0" },
        { "originalQuestion": "연구책임자 성명", "mergedKey": "q_1" }
      ]
    }
  ]
}`
}

// ── Phase 3: 지능형 매핑 및 초안 생성 (청크 단위) ──────────────
const CHUNK_SIZE = 15  // 한 번에 처리할 최대 문항 수

function buildMappingPrompt(
  fileName: string,
  chunkItems: { question: string; answerKey: string }[],
  mergedQuestions: IRBFormQuestion[],
  userAnswers: IRBUserAnswers,
  naturalLanguageInput: string
): string {
  // 이 청크에 직접 답변이 있는 항목
  const directAnswers = chunkItems
    .filter((item) => userAnswers[item.answerKey]?.trim())
    .map((item) => `[문항] ${item.question}\n[직접 입력값] ${userAnswers[item.answerKey]}`)
    .join('\n\n')

  // 전체 개별 입력 컨텍스트 (추론 근거용 — 다른 청크 포함)
  const globalContext = mergedQuestions
    .filter((q) => userAnswers[q.key]?.trim())
    .map((q) => `• ${q.label}: ${userAnswers[q.key]}`)
    .join('\n')

  const hasNaturalInput = naturalLanguageInput.trim().length > 0
  const hasDirectAnswers = directAnswers.length > 0

  // 이 청크의 문항 목록
  const questionList = chunkItems
    .map((item, i) => {
      const direct = userAnswers[item.answerKey]?.trim()
      return direct
        ? `${i + 1}. ${item.question}  ← 직접 입력값 있음`
        : `${i + 1}. ${item.question}`
    })
    .join('\n')

  return `[시스템 지침 — 절대 준수]
당신은 IRB 서류 작성 전문가입니다.

★★ 핵심 규칙 (우선순위 순) ★★
1순위 — 직접 입력값: "← 직접 입력값 있음" 표시된 문항은 아래 직접 입력값 섹션의 내용을 그대로 사용
2순위 — 자연어 추출: 자연어 연구 설명에서 해당 문항과 관련된 모든 정보를 적극적으로 찾아 사용
   예시: "연구 제목은 X입니다" → "연구 제목" 문항에 X 사용
   예시: "참여자는 Y명입니다" → "연구 대상자 수" 문항에 Y 사용
   예시: "Z 대학교 소속입니다" → "소속 기관" 문항에 Z 대학교 사용
3순위 — 다른 답변 활용: 다른 문항의 답변에서 맥락을 추론하여 작성
4순위 — ${MISSING_MARKER}: 위 1~3순위 모두에서 관련 정보가 단 하나도 없을 때만 사용

${hasDirectAnswers ? `=== 직접 입력값 (1순위 — 반드시 그대로 사용) ===
${directAnswers}

` : ''}${globalContext ? `=== 개별 입력된 전체 답변 (3순위 추론용) ===
${globalContext}

` : ''}${hasNaturalInput ? `=== 자연어 연구 설명 (2순위 — 적극적으로 정보 추출) ===
${naturalLanguageInput.slice(0, 4000)}

` : ''}=== [파일: ${fileName}] 아래 ${chunkItems.length}개 문항에 순서대로 답변하세요 ===
${questionList}

출력 규칙:
- 마크다운, 인사말, 설명 없이 아래 형식만 출력
- 반드시 ${chunkItems.length}개 문항 전부, 순서대로 출력
- [문항] 뒤에는 원본 문항 텍스트를 그대로 복사 (절대 요약하거나 변경하지 말 것)
- [답변] 뒤에는 생성된 답변 또는 정보 없을 때만 "${MISSING_MARKER}"

출력 형식:
[파일: ${fileName}]
[문항] 원본문항텍스트
[답변] 답변내용`
}

// ── Phase 3 결과 파싱 (퍼지 매칭 포함) ──────────────────────────
function parseFileOutput(raw: string): { question: string; answer: string }[] {
  const items: { question: string; answer: string }[] = []
  const parts = raw.split(/\[문항\]/).slice(1)
  for (const part of parts) {
    const [questionPart, ...answerParts] = part.split(/\[답변\]/)
    const question = (questionPart ?? '').trim()
    const answer = (answerParts.join('[답변]') ?? '').trim()
    if (question) items.push({ question, answer: answer || MISSING_MARKER })
  }
  return items
}

// 파싱된 문항 텍스트와 원본 문항 텍스트를 매칭 (퍼지)
function matchParsedToOriginal(
  parsed: { question: string; answer: string }[],
  original: string
): string | undefined {
  const origNorm = original.trim().toLowerCase().replace(/\s+/g, ' ')

  // 1. 정확히 일치
  const exact = parsed.find((p) => p.question.trim().toLowerCase().replace(/\s+/g, ' ') === origNorm)
  if (exact) return exact.answer

  // 2. 원본이 파싱 문항을 포함하거나, 파싱 문항이 원본을 포함
  const contains = parsed.find((p) => {
    const pNorm = p.question.trim().toLowerCase().replace(/\s+/g, ' ')
    return origNorm.includes(pNorm) || pNorm.includes(origNorm)
  })
  if (contains) return contains.answer

  // 3. 자카드 유사도 0.6 이상
  const ngrams = (s: string, n = 2) => {
    const set = new Set<string>()
    for (let i = 0; i <= s.length - n; i++) set.add(s.slice(i, i + n))
    return set
  }
  let bestScore = 0.6
  let bestAnswer: string | undefined
  for (const p of parsed) {
    const pNorm = p.question.trim().toLowerCase().replace(/\s+/g, ' ')
    const sa = ngrams(origNorm)
    const sb = ngrams(pNorm)
    if (sa.size === 0 && sb.size === 0) continue
    let inter = 0
    for (const g of sa) if (sb.has(g)) inter++
    const score = inter / (sa.size + sb.size - inter)
    if (score > bestScore) { bestScore = score; bestAnswer = p.answer }
  }
  return bestAnswer
}

// ── 유사도 기반 중복 통합 폴백 ──────────────────────────────
function normalizeQ(q: string): string {
  return q.trim().toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]【】:：·•\-]/g, '')
}

// 두 문자열의 자카드 문자 n-gram 유사도 (0~1)
function jaccardSimilarity(a: string, b: string, n = 2): number {
  const ngrams = (s: string) => {
    const set = new Set<string>()
    for (let i = 0; i <= s.length - n; i++) set.add(s.slice(i, i + n))
    return set
  }
  const sa = ngrams(a)
  const sb = ngrams(b)
  if (sa.size === 0 && sb.size === 0) return 1
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const g of sa) if (sb.has(g)) inter++
  return inter / (sa.size + sb.size - inter)
}

function similarityBasedMerge(
  perFileRaw: { fileName: string; questions: string[] }[]
): IRBFormDraftResult {
  const SIMILARITY_THRESHOLD = 0.55
  const groups: { key: string; canonical: string; variants: Set<string>; norm: string }[] = []
  let idx = 0

  for (const pf of perFileRaw) {
    for (const q of pf.questions) {
      const norm = normalizeQ(q)
      // 기존 그룹 중 유사한 것 찾기
      let bestGroup: (typeof groups)[0] | null = null
      let bestScore = SIMILARITY_THRESHOLD - 0.001
      for (const g of groups) {
        const score = jaccardSimilarity(norm, g.norm)
        if (score > bestScore) { bestScore = score; bestGroup = g }
      }
      if (bestGroup) {
        bestGroup.variants.add(q)
      } else {
        groups.push({ key: `q_${idx++}`, canonical: q, variants: new Set([q]), norm })
      }
    }
  }

  const questions: IRBFormQuestion[] = groups.map((g) => ({
    key: g.key,
    label: g.canonical,
    multiline: g.canonical.length > 15,
    originalVariants: Array.from(g.variants),
  }))

  // 각 파일 문항 → 그룹 key 매핑
  const fileSections = perFileRaw.map((pf) => ({
    fileName: pf.fileName,
    items: pf.questions.map((q) => {
      const norm = normalizeQ(q)
      let bestKey = `q_fallback_${q}`
      let bestScore = -1
      for (const g of groups) {
        const score = jaccardSimilarity(norm, g.norm)
        if (score > bestScore) { bestScore = score; bestKey = g.key }
      }
      return { question: q, answerKey: bestKey }
    }),
  }))

  return { questions, fileSections }
}

// ── LLM 중복통합 결과 타입 ─────────────────────────────────────
interface LLMMergeResult {
  mergedQuestions: Array<{
    key: string
    label: string
    multiline: boolean
    variants: string[]
  }>
  fileMappings: Array<{
    fileName: string
    items: Array<{ originalQuestion: string; mergedKey: string }>
  }>
}

// ── 메인 핸들러 ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '로그인이 필요합니다.' }, { status: 401 })
  }

  const contentType = req.headers.get('content-type') ?? ''

  // ══════════════════════════════════════════════════════════
  // Phase 1: 파일 → 문항 추출 + LLM 의미 기반 중복 통합
  // ══════════════════════════════════════════════════════════
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
        if (isLuxiaProvider()) {
          // Luxia는 PDF native 미지원 — 스킵
          console.warn('[irb-form-draft] PDF skipped on Luxia provider:', f.name)
          continue
        }
        try {
          const { anthropic } = await import('@/lib/anthropic')
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 2048,
            messages: [{ role: 'user', content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } } as any,
              { type: 'text', text: '이 PDF 문서의 모든 텍스트를 그대로 추출해주세요. 양식 구조와 항목명을 최대한 보존하세요.' },
            ]}] as any,
          })
          const text = response.content[0]?.type === 'text' ? response.content[0].text : null
          if (text) extracted.push({ name: f.name, text })
        } catch (e) {
          console.error('[irb-form-draft] PDF extraction failed:', e)
        }
      } else {
        const text = await extractText(f.name, buffer)
        if (text) extracted.push({ name: f.name, text })
      }
    }

    if (extracted.length === 0)
      return NextResponse.json({ error: 'ParseError', message: '파일에서 텍스트를 읽을 수 없습니다.' }, { status: 422 })

    try {
      // Phase 1-A: 파일별 raw 문항 추출 (순차 처리)
      const perFileRaw: { fileName: string; questions: string[] }[] = []
      for (const f of extracted) {
        const raw = await generateText({
          messages: [{ role: 'user', content: buildRawExtractionPrompt(f.name, f.text) }],
          maxTokens: 2000,
        })
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          perFileRaw.push({ fileName: f.name, questions: [] })
          continue
        }
        try {
          const parsed = JSON.parse(jsonMatch[0]) as { items?: { question: string }[] }
          perFileRaw.push({
            fileName: f.name,
            questions: (parsed.items ?? []).map((i) => i.question).filter(Boolean),
          })
        } catch {
          perFileRaw.push({ fileName: f.name, questions: [] })
        }
      }

      const totalQuestions = perFileRaw.reduce((s, f) => s + f.questions.length, 0)
      console.log(`[irb-form-draft] Phase 1-A: extracted ${totalQuestions} raw questions from ${perFileRaw.length} files`)

      // Phase 1-B: 항상 LLM 의미 기반 중복 통합 (단일 파일 포함)
      let result: IRBFormDraftResult

      {
        // LLM 의미 기반 중복 통합
        const dedupeRaw = await generateText({
          messages: [{ role: 'user', content: buildDeduplicationPrompt(perFileRaw) }],
          maxTokens: 4000,
        })

        const jsonMatch = dedupeRaw.match(/\{[\s\S]*\}/)
        let mergeResult: LLMMergeResult | null = null
        if (jsonMatch) {
          try {
            mergeResult = JSON.parse(jsonMatch[0]) as LLMMergeResult
          } catch {
            console.warn('[irb-form-draft] dedup JSON parse failed, falling back to similarity-based merge')
          }
        }

        if (mergeResult?.mergedQuestions?.length && mergeResult?.fileMappings?.length) {
          // LLM 결과 활용
          const questions: IRBFormQuestion[] = mergeResult.mergedQuestions.map((q, i) => ({
            key: q.key || `q_${i}`,
            label: q.label,
            multiline: q.multiline ?? q.label.length > 15,
            originalVariants: q.variants ?? [q.label],
          }))

          const keySet = new Set(questions.map((q) => q.key))
          const fileSections = mergeResult.fileMappings.map((fm) => ({
            fileName: fm.fileName,
            items: fm.items
              .filter((item) => keySet.has(item.mergedKey))
              .map((item) => ({
                question: item.originalQuestion,
                answerKey: item.mergedKey,
              })),
          }))

          result = { questions, fileSections }
        } else {
          // LLM 실패 → 폴백: 유사도 기반 중복 통합
          console.warn('[irb-form-draft] LLM dedup failed, using similarity-based fallback')
          result = similarityBasedMerge(perFileRaw)
        }
      }

      console.log(`[irb-form-draft] Phase 1 complete: ${result.questions.length} merged questions, ${result.fileSections.length} file sections`)
      return NextResponse.json(result)
    } catch (e) {
      console.error('[irb-form-draft] Phase 1 error:', e)
      return NextResponse.json({ error: 'InternalServerError', message: '문항 추출에 실패했습니다.' }, { status: 500 })
    }
  }

  // ══════════════════════════════════════════════════════════
  // Phase 3: 사용자 답변 → 파일별 지능형 매핑 및 초안 생성
  // ══════════════════════════════════════════════════════════
  if (contentType.includes('application/json')) {
    let body: {
      projectId?: string
      fileSections: IRBFormDraftResult['fileSections']
      mergedQuestions: IRBFormDraftResult['questions']
      userAnswers: IRBUserAnswers
      naturalLanguageInput: string
    }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: 'BadRequest' }, { status: 400 }) }

    const { fileSections, mergedQuestions, userAnswers, naturalLanguageInput } = body

    if (!fileSections?.length) {
      return NextResponse.json({ error: 'BadRequest', message: 'fileSections가 필요합니다.' }, { status: 400 })
    }
    if (!mergedQuestions?.length) {
      return NextResponse.json({ error: 'BadRequest', message: 'mergedQuestions가 필요합니다.' }, { status: 400 })
    }
    // 개별 답변과 자연어 입력 중 하나는 있어야 함
    const hasAnyInput =
      naturalLanguageInput?.trim() ||
      Object.values(userAnswers ?? {}).some((v) => v?.trim())
    if (!hasAnyInput) {
      return NextResponse.json({
        error: 'BadRequest',
        message: '연구 설명 또는 개별 입력 중 하나 이상을 입력해주세요.',
      }, { status: 400 })
    }

    try {
      const perFileSections: IRBFormDraftOutput['sections'] = []

      for (const fileSection of fileSections) {
        const allItems = fileSection.items
        const allOriginalQuestions = allItems.map((i) => i.question)
        const collectedItems: { question: string; answer: string }[] = []

        // 문항을 CHUNK_SIZE 단위로 나눠 처리
        for (let start = 0; start < allItems.length; start += CHUNK_SIZE) {
          const chunk = allItems.slice(start, start + CHUNK_SIZE)
          const prompt = buildMappingPrompt(
            fileSection.fileName,
            chunk,
            mergedQuestions,
            userAnswers ?? {},
            naturalLanguageInput ?? '',
          )
          const raw = await generateText({
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 2500,
          })

          const parsed = parseFileOutput(raw)

          // 파싱 결과를 원본 문항 텍스트 기준으로 매핑 (퍼지 매칭)
          for (const item of chunk) {
            // 1순위: LLM 출력에서 퍼지 매칭
            let answer = matchParsedToOriginal(parsed, item.question)

            // 2순위: 직접 입력값이 있으면 안전망으로 사용 (LLM이 누락했을 때)
            if (!answer && userAnswers[item.answerKey]?.trim()) {
              answer = userAnswers[item.answerKey]
            }

            collectedItems.push({ question: item.question, answer: answer ?? MISSING_MARKER })
          }
        }

        // 원본 문항 순서 보장
        const collectedMap = new Map(collectedItems.map((i) => [i.question, i.answer]))
        perFileSections.push({
          fileName: fileSection.fileName,
          items: allOriginalQuestions.map((q) => ({
            question: q,
            answer: collectedMap.get(q) ?? MISSING_MARKER,
          })),
        })
      }

      // rawText 생성
      const rawText = perFileSections
        .map((s) => {
          const items = s.items
            .map((i) => `[문항] ${i.question}\n[답변] ${i.answer}`)
            .join('\n\n')
          return `[파일: ${s.fileName}]\n${items}`
        })
        .join('\n\n' + '─'.repeat(40) + '\n\n')

      const output: IRBFormDraftOutput = { sections: perFileSections, rawText }

      // Phase 3 완료 → DB에 최신 초안 저장 (projectId가 있을 때)
      const projectId = body.projectId as string | undefined
      if (projectId) {
        try {
          await prisma.project.updateMany({
            where: { id: projectId, userId: session.user.id },
            data: { formDraftJson: JSON.stringify(output) },
          })
        } catch (e) {
          // DB 저장 실패는 응답을 막지 않음 — 로그만
          console.warn('[irb-form-draft] DB save failed:', e)
        }
      }

      return NextResponse.json(output satisfies IRBFormDraftOutput)
    } catch (e) {
      console.error('[irb-form-draft] Phase 3 error:', e)
      return NextResponse.json({ error: 'InternalServerError', message: '초안 생성에 실패했습니다.' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'BadRequest' }, { status: 400 })
}

// ══════════════════════════════════════════════════════════
// PATCH: 미완 항목만 LLM으로 치환 (Patch Update)
// Body: { projectId, currentOutput: IRBFormDraftOutput, supplements: { question, fileName, supplement }[] }
// ══════════════════════════════════════════════════════════
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    projectId?: string
    currentOutput: IRBFormDraftOutput
    supplements: Array<{
      fileName: string
      question: string
      supplement: string   // 유저가 입력한 추가 정보
    }>
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'BadRequest' }, { status: 400 }) }

  const { projectId, currentOutput, supplements } = body
  if (!currentOutput?.sections?.length || !supplements?.length) {
    return NextResponse.json({ error: 'BadRequest', message: 'currentOutput과 supplements가 필요합니다.' }, { status: 400 })
  }

  // supplement를 (fileName, question) 키로 빠른 조회용 맵으로 구성
  const suppMap = new Map<string, string>()
  for (const s of supplements) {
    suppMap.set(`${s.fileName}|||${s.question.trim()}`, s.supplement.trim())
  }

  try {
    // 파일별로 미완 항목만 LLM 치환
    const updatedSections: IRBFormDraftOutput['sections'] = []

    for (const sec of currentOutput.sections) {
      // 이 파일에서 치환이 필요한 항목만 추출
      const toFill = sec.items.filter((item) => {
        const supp = suppMap.get(`${sec.fileName}|||${item.question.trim()}`)
        return supp && item.answer.includes(MISSING_MARKER)
      })

      if (toFill.length === 0) {
        // 치환할 항목 없으면 그대로 유지
        updatedSections.push(sec)
        continue
      }

      // LLM 프롬프트: 기존 초안 유지 + MISSING 항목만 치환
      const existingDraft = sec.items
        .map((i) => `[문항] ${i.question}\n[답변] ${i.answer}`)
        .join('\n\n')

      const supplementList = toFill
        .map((item) => {
          const supp = suppMap.get(`${sec.fileName}|||${item.question.trim()}`)!
          return `[문항] ${item.question}\n[추가 정보] ${supp}`
        })
        .join('\n\n')

      const prompt = `[시스템 지침 — 절대 준수]
당신은 IRB 서류 작성 전문가입니다.

★★ 핵심 규칙 ★★
1. 아래 [기존 초안]의 모든 내용을 100% 그대로 유지하세요
2. 단, "${MISSING_MARKER}"라고 표시된 항목만 [추가 정보]를 바탕으로 알맞은 텍스트로 치환하세요
3. 기존에 잘 작성된 다른 항목의 내용을 절대 수정하거나 축약하지 마세요
4. 추가 정보가 없는 MISSING 항목은 그대로 "${MISSING_MARKER}"로 유지하세요

=== [기존 초안] ===
[파일: ${sec.fileName}]
${existingDraft}

=== [치환할 항목의 추가 정보] ===
${supplementList}

출력 규칙:
- 마크다운, 인사말, 설명 없이 아래 형식만 출력
- 반드시 모든 ${sec.items.length}개 문항을 순서대로 포함
- [문항] 뒤에는 원본 문항 텍스트 그대로 복사
- MISSING이 아닌 항목: 기존 답변 그대로 출력
- MISSING이고 추가 정보 있는 항목: 추가 정보를 IRB 문서에 적합한 한국어로 작성하여 출력
- MISSING이고 추가 정보 없는 항목: 정확히 "${MISSING_MARKER}" 출력

출력 형식:
[파일: ${sec.fileName}]
[문항] 원본문항텍스트
[답변] 답변내용`

      const raw = await generateText({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 3000,
      })

      const parsed = parseFileOutput(raw)
      const parsedMap = new Map(parsed.map((i) => [i.question.trim(), i.answer]))

      // 원본 순서 보장 + 퍼지 매칭
      const updatedItems = sec.items.map((item) => {
        const matched = matchParsedToOriginal(parsed, item.question)
        return { question: item.question, answer: matched ?? item.answer }
      })

      updatedSections.push({ fileName: sec.fileName, items: updatedItems })
      void parsedMap // suppress unused warning
    }

    // rawText 재생성
    const rawText = updatedSections
      .map((s) => {
        const items = s.items
          .map((i) => `[문항] ${i.question}\n[답변] ${i.answer}`)
          .join('\n\n')
        return `[파일: ${s.fileName}]\n${items}`
      })
      .join('\n\n' + '─'.repeat(40) + '\n\n')

    const result: IRBFormDraftOutput = { sections: updatedSections, rawText }

    // DB에 최신 초안 저장
    if (projectId) {
      try {
        await prisma.project.updateMany({
          where: { id: projectId, userId: session.user.id },
          data: { formDraftJson: JSON.stringify(result) },
        })
      } catch (e) {
        console.warn('[irb-form-draft PATCH] DB save failed:', e)
      }
    }

    return NextResponse.json(result satisfies IRBFormDraftOutput)
  } catch (e) {
    console.error('[irb-form-draft PATCH] error:', e)
    return NextResponse.json({ error: 'InternalServerError', message: '보완 생성에 실패했습니다.' }, { status: 500 })
  }
}
