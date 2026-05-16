export interface ModuleRecommendation {
  moduleId: string
  status: 'required' | 'recommended'
  reason: string
  matchedSection: string
}
