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

// IRB 폼 초안 생성 관련 타입
export interface IRBFormQuestion {
  key: string           // 내부 식별자 (예: "researcher_name")
  label: string         // 사용자에게 보여줄 질문 (예: "연구책임자 성명")
  placeholder?: string
  multiline?: boolean   // textarea 여부
}

export interface IRBFormFileSection {
  fileName: string
  items: Array<{ question: string; answerKey: string }>
}

export interface IRBFormDraftResult {
  questions: IRBFormQuestion[]           // 중복 통합된 질문 목록
  fileSections: IRBFormFileSection[]     // 파일별 문항 매핑
}

export interface IRBFormDraftOutput {
  // 파일별 [문항][답변] 결과
  sections: Array<{
    fileName: string
    items: Array<{ question: string; answer: string }>
  }>
  rawText: string  // 복사용 전체 텍스트
}
