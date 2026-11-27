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

/**
 * 컨텍스트 전체 상한. 문항 청크마다 반복 전달되므로 Luxia 응답 시간(타임아웃·ECONNRESET)을 고려해 작게 둔다.
 * 사용자가 직접 쓴 모듈 메모는 이 상한과 관계없이 전부 넣고, 문서 요약본은 남은 자리만큼만 넣는다.
 */
export const PROJECT_CONTEXT_MAX_CHARS = 8000

export const TRUNCATION_MARK = '\n…(이하 생략)'

/** 컨텍스트가 없으면 빈 문자열 */
export function buildProjectContext(src: ProjectContextSource | null | undefined): string {
  if (!src) return ''

  // 1순위: 사용자가 모듈 카드에 직접 작성한 메모 — 자르지 않는다
  const written = (src.modules ?? [])
    .map((m) => ({ name: m.module?.name?.trim() || '(이름 없음)', content: (m.content ?? '').trim() }))
    .filter((m) => m.content.length > 0)
  const modulesBlock = written.length > 0
    ? `[사용자가 모듈 카드에 직접 작성한 내용]\n${written.map((m) => `■ ${m.name}\n${m.content}`).join('\n\n')}`
    : ''

  // 2순위: 문서 분석 요약본 — 상한에서 모듈 메모를 뺀 나머지 자리만큼
  const summary = src.sourceSummary?.trim() ?? ''
  let summaryBlock = ''
  if (summary) {
    const header = '[문서 분석 요약본]\n'
    const sep = modulesBlock ? 2 : 0
    const budget = PROJECT_CONTEXT_MAX_CHARS - modulesBlock.length - sep - header.length
    if (summary.length <= budget) summaryBlock = header + summary
    else if (budget > TRUNCATION_MARK.length + 200) {
      summaryBlock = header + summary.slice(0, budget - TRUNCATION_MARK.length) + TRUNCATION_MARK
    }
    // 남은 자리가 거의 없으면 요약본은 넣지 않는다 (모듈 메모가 우선)
  }

  return [summaryBlock, modulesBlock].filter(Boolean).join('\n\n')
}
