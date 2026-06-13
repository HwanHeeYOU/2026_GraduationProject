'use client'

import { useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import type { ProjectModuleWithMeta } from './ModuleCard'

interface BulkGeneratePanelProps {
  modules: ProjectModuleWithMeta[]
  projectId: string
  onGenerated: (moduleId: string, content: string) => void
}

interface Progress {
  done: number
  total: number
  currentName: string
}

export default function BulkGeneratePanel({ modules, projectId, onGenerated }: BulkGeneratePanelProps) {
  const [description, setDescription] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [failedModules, setFailedModules] = useState<string[]>([])
  const [done, setDone] = useState(false)

  const handleBulkGenerate = async () => {
    if (!description.trim() || isGenerating) return

    setIsGenerating(true)
    setDone(false)
    setFailedModules([])

    const failed: string[] = []

    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i]
      setProgress({ done: i, total: modules.length, currentName: mod.module.name })

      try {
        const res = await fetch('/api/ai/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            moduleId: mod.moduleId,
            keywords: description,
            moduleMetadata: {
              name: mod.module.name,
              description: mod.module.description,
              category: mod.module.category,
            },
          }),
        })

        if (!res.ok) {
          failed.push(mod.module.name)
          continue
        }

        const data = await res.json()
        onGenerated(mod.id, data.content)
      } catch {
        failed.push(mod.module.name)
      }
    }

    setFailedModules(failed)
    setProgress({ done: modules.length, total: modules.length, currentName: '' })
    setIsGenerating(false)
    setDone(true)
  }

  return (
    <div className="glass-card p-5 mb-6 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-white">실험 설명으로 전체 초안 생성</h2>
      </div>

      <p className="text-xs text-slate-400">
        연구 실험을 설명하면 선택된 모든 모듈의 초안을 자동으로 작성해드립니다.
      </p>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={isGenerating}
        placeholder="예) 본 연구는 대학생을 대상으로 설문 조사를 통해 스트레스와 학업성취도의 관계를 분석합니다. 참여자는 온라인 설문에 자발적으로 응합니다..."
        className="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 outline-none resize-y min-h-[80px] disabled:opacity-50"
      />

      <div className="flex items-center gap-4">
        <button
          onClick={handleBulkGenerate}
          disabled={isGenerating || !description.trim()}
          className="cta-primary flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              생성 중...
            </>
          ) : (
              <>전체 모듈 AI 초안 생성 ({modules.length}개)</>
          )}
        </button>

        {isGenerating && progress && (
          <span className="text-xs text-slate-400">
            {progress.done} / {progress.total} 완료
            {progress.currentName && ` · ${progress.currentName}`}
          </span>
        )}

        {done && !isGenerating && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 size={13} />
            {failedModules.length === 0
              ? `${modules.length}개 모두 생성 완료`
              : `${modules.length - failedModules.length}개 완료`}
          </span>
        )}
      </div>

      {failedModules.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-red-400">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>생성 실패: {failedModules.join(', ')}</span>
        </div>
      )}
    </div>
  )
}
