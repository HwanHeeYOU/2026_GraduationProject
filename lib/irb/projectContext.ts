/**
 * 초안 생성 AI 프롬프트에 주입할 "프로젝트 컨텍스트".
 * - sourceSummary : 업로드 문서 분석 요약본
 * - modules       : 워크스페이스 모듈 카드에 사용자가 직접 작성한 내용
 * 둘 다 사용자가 제공한 사실이므로 프롬프트에서 최우선 근거(Ground Truth)로 쓴다.
 */
export interface ProjectContextSource {
  sourceSummary?: string | null
  modules?: Array<{ content?: string | null; module?: { name?: string | null } | null }> | null
}

/** 컨텍스트 전체 상한 (문항 청크마다 반복 전달되므로 과도하게 키우지 않는다) */
export const PROJECT_CONTEXT_MAX_CHARS = 20000

/** 컨텍스트가 없으면 빈 문자열 */
export function buildProjectContext(src: ProjectContextSource | null | undefined): string {
  if (!src) return ''
  const parts: string[] = []

  const summary = src.sourceSummary?.trim()
  if (summary) parts.push(`[문서 분석 요약본]\n${summary}`)

  const written = (src.modules ?? [])
    .map((m) => ({ name: m.module?.name?.trim() || '(이름 없음)', content: (m.content ?? '').trim() }))
    .filter((m) => m.content.length > 0)
  if (written.length > 0) {
    parts.push(`[사용자가 모듈 카드에 직접 작성한 내용]\n${written.map((m) => `■ ${m.name}\n${m.content}`).join('\n\n')}`)
  }

  const text = parts.join('\n\n')
  return text.length > PROJECT_CONTEXT_MAX_CHARS ? text.slice(0, PROJECT_CONTEXT_MAX_CHARS) + '\n…(이하 생략)' : text
}
