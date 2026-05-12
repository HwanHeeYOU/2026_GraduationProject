'use client'

import { useState } from 'react'
import { useAutoSave } from '@/hooks/useAutoSave'
import SaveStatusIndicator from './SaveStatusIndicator'
import FormulaRenderer from './FormulaRenderer'
import AIGenerateButton from './AIGenerateButton'

export interface ProjectModuleWithMeta {
  id: string
  moduleId: string
  content: string
  order: number
  module: {
    id: string
    name: string
    description: string
    category: string
    isRequired: boolean
    hasFormula: boolean
    promptHint?: string | null
  }
}

interface ModuleCardProps {
  module: ProjectModuleWithMeta
  projectId: string
}

export default function ModuleCard({ module, projectId }: ModuleCardProps) {
  const { content, setContent, saveStatus } = useAutoSave(projectId, module.id, module.content)
  const [keywords, setKeywords] = useState('')

  const handleGenerated = (generated: string) => {
    setContent(generated)
  }

  return (
    <div className="glass-card p-5 flex flex-col gap-4">
      {/* 카드 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-white">{module.module.name}</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
              {module.module.category}
            </span>
            {module.module.isRequired && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 font-semibold">
                필수
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1 line-clamp-2">{module.module.description}</p>
        </div>
        <SaveStatusIndicator status={saveStatus} />
      </div>

      {/* AI 키워드 입력 */}
      <div className="space-y-2">
        <label className="text-xs text-slate-400">연구 키워드 (AI 초안 생성용)</label>
        <input
          type="text"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder={module.module.promptHint ?? '키워드를 입력하세요...'}
          className="glass-input w-full px-3 py-2 rounded-lg text-sm text-white placeholder-slate-500 outline-none"
        />
        <AIGenerateButton
          moduleId={module.moduleId}
          projectId={projectId}
          keywords={keywords}
          moduleName={module.module.name}
          moduleDescription={module.module.description}
          moduleCategory={module.module.category}
          onGenerated={handleGenerated}
        />
      </div>

      {/* 텍스트 편집 영역 */}
      <div className="space-y-1">
        <label className="text-xs text-slate-400">내용</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="내용을 입력하거나 AI 초안을 생성하세요..."
          className="glass-input w-full px-3 py-2 rounded-lg text-sm text-white placeholder-slate-500 outline-none resize-y min-h-[120px]"
        />
      </div>

      {/* 수식 렌더링 */}
      {module.module.hasFormula && content && (
        <FormulaRenderer formula={content} />
      )}
    </div>
  )
}
