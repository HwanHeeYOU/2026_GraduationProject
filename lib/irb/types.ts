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
