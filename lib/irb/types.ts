export interface ModuleRecommendation {
  moduleId: string
  status: 'required' | 'recommended'
  reason: string
  matchedSection: string
}

export interface NewModuleSuggestion {
  suggestedName: string
  suggestedDescription: string
  suggestedCategory: string
  status: 'required' | 'recommended'
  reason: string
  matchedSection: string
}

// ── IRB 3-Phase 파이프라인 타입 ─────────────────────────────────

/**
 * Phase 1 결과: LLM이 의미 기반으로 중복 통합한 최종 문항 목록
 */
export interface IRBFormQuestion {
  key: string           // 내부 식별자 (예: "q_0_연구_제목")
  label: string         // 사용자에게 보여줄 통합 질문 (예: "연구 제목")
  placeholder?: string
  multiline?: boolean   // textarea 여부
  /** 이 통합 문항이 어떤 원본 표현들을 하나로 합쳤는지 (예: ["연구 제목", "과제명"]) */
  originalVariants?: string[]
}

export interface IRBFormFileSection {
  fileName: string
  items: Array<{ question: string; answerKey: string }>
}

export interface IRBFormDraftResult {
  questions: IRBFormQuestion[]           // Phase 1: LLM 중복 통합 질문 목록
  fileSections: IRBFormFileSection[]     // 파일별 문항 → answerKey 매핑
}

/**
 * Phase 2 입력: 사용자가 채운 답변 맵
 * key = IRBFormQuestion.key, value = 사용자 입력 텍스트
 */
export type IRBUserAnswers = Record<string, string>

/**
 * 사용자가 입력한 원본 정보 (DB: Project.userInputJson)
 * 보완/재생성 때 AI에 다시 전달되는 근거 자료다.
 */
export interface IRBUserInput {
  userAnswers: IRBUserAnswers
  naturalLanguageInput: string
}

/**
 * Phase 3 결과: 파일별 문항-답변 초안
 */
export interface IRBFormDraftOutput {
  sections: Array<{
    fileName: string
    items: Array<{ question: string; answer: string }>
  }>
  rawText: string  // 복사용 전체 텍스트
}
