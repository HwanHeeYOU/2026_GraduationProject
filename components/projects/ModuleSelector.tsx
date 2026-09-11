'use client'

import { useState, useEffect } from 'react'
import { AlertCircle, Plus, RefreshCw, Sparkles, X } from 'lucide-react'
import type { ModuleRecommendation, NewModuleSuggestion } from '@/lib/irb/types'

interface ModuleItem {
  id: string
  name: string
  description: string
  category: string
  isRequired: boolean
  order: number
  hasFormula: boolean
  promptHint?: string | null
  institutionIsRequired: boolean
  priority: number
}

interface ModuleSelectorProps {
  institutionId: string
  selectedIds: string[]
  onChange: (selectedIds: string[]) => void
  recommendations?: ModuleRecommendation[]
  newSuggestions?: NewModuleSuggestion[]
}

export default function ModuleSelector({
  institutionId,
  selectedIds,
  onChange,
  recommendations,
  newSuggestions,
}: ModuleSelectorProps) {
  const [items, setItems] = useState<ModuleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingSuggestions, setPendingSuggestions] = useState<NewModuleSuggestion[]>([])
  const [addingKey, setAddingKey] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  const recMap = new Map(recommendations?.map((r) => [r.moduleId, r]) ?? [])

  useEffect(() => {
    setPendingSuggestions(newSuggestions ?? [])
  }, [newSuggestions])

  const fetchModules = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/institutions/${institutionId}/modules`)
      if (!res.ok) throw new Error('fetch failed')
      const data: { modules: ModuleItem[] } = await res.json()
      setItems(data.modules)

      const requiredIds = data.modules.filter((m) => m.institutionIsRequired).map((m) => m.id)
      const merged = Array.from(new Set([...selectedIds, ...requiredIds]))
      onChange(merged)
    } catch {
      setError('학교 정보를 불러오는 데 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (institutionId) fetchModules()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId])

  const toggle = (moduleId: string, isRequired: boolean) => {
    if (isRequired) return
    if (selectedIds.includes(moduleId)) {
      onChange(selectedIds.filter((id) => id !== moduleId))
    } else {
      onChange([...selectedIds, moduleId])
    }
  }

  const dismissSuggestion = (suggestion: NewModuleSuggestion) => {
    setPendingSuggestions((prev) => prev.filter((s) => s !== suggestion))
  }

  const addSuggestion = async (suggestion: NewModuleSuggestion) => {
    setAddingKey(suggestion.suggestedName)
    setAddError(null)
    try {
      const res = await fetch(`/api/institutions/${institutionId}/modules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: suggestion.suggestedName,
          description: suggestion.suggestedDescription,
          category: suggestion.suggestedCategory,
          isRequired: suggestion.status === 'required',
        }),
      })
      if (!res.ok) throw new Error('failed')
      const data: { module: ModuleItem } = await res.json()

      setItems((prev) => [...prev, data.module])
      onChange([...selectedIds, data.module.id])
      dismissSuggestion(suggestion)
    } catch {
      setAddError('새 항목 추가에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setAddingKey(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400 text-sm gap-2">
        <RefreshCw size={16} className="animate-spin" />
        모듈 목록 불러오는 중...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-400 text-sm">
        <AlertCircle size={16} className="shrink-0" />
        <span>{error}</span>
        <button
          onClick={fetchModules}
          className="ml-auto underline text-red-300 hover:text-red-200 text-xs"
        >
          다시 시도
        </button>
      </div>
    )
  }

  const grouped = items.reduce<Record<string, ModuleItem[]>>((acc, item) => {
    const cat = item.category
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {})

  const hasRecommendations = recMap.size > 0

  return (
    <div className="space-y-5">
      {hasRecommendations && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-300 text-xs">
          <Sparkles size={13} className="shrink-0" />
          업로드한 파일을 분석해 추천 모듈을 표시했습니다. 직접 확인 후 추가·해제할 수 있습니다.
        </div>
      )}

      {pendingSuggestions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-amber-300 uppercase tracking-wider mb-1 px-1 flex items-center gap-1.5">
            <Sparkles size={12} />
            목록에 없는 새 항목 제안
          </h3>
          {addError && (
            <p className="text-xs text-red-400 px-1">{addError}</p>
          )}
          <div className="space-y-2">
            {pendingSuggestions.map((s) => (
              <div
                key={s.suggestedName}
                className="flex items-start gap-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">{s.suggestedName}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-600/30 text-slate-300 border border-slate-500/40">
                      {s.suggestedCategory}
                    </span>
                    {s.status === 'required' && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30">
                        필수로 추정
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{s.suggestedDescription}</p>
                  <div className="mt-1.5 space-y-0.5">
                    <p className="text-xs text-amber-300">{s.reason}</p>
                    <p className="text-[11px] text-slate-500">근거: {s.matchedSection}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => addSuggestion(s)}
                    disabled={addingKey === s.suggestedName}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-50"
                  >
                    <Plus size={12} />
                    {addingKey === s.suggestedName ? '추가 중...' : '항목 추가'}
                  </button>
                  <button
                    onClick={() => dismissSuggestion(s)}
                    disabled={addingKey === s.suggestedName}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/10 disabled:opacity-50"
                    aria-label="무시"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.entries(grouped).map(([category, groupItems]) => (
        <div key={category}>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
            {category}
          </h3>
          <div className="space-y-2">
            {groupItems.map((item) => {
              const checked = selectedIds.includes(item.id)
              const institutionRequired = item.institutionIsRequired
              const rec = recMap.get(item.id)

              return (
                <label
                  key={item.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                    checked
                      ? rec
                        ? 'border-blue-400/50 bg-blue-500/15'
                        : 'border-blue-500/40 bg-blue-500/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/[0.08]'
                  } ${institutionRequired ? 'cursor-default' : 'cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={institutionRequired}
                    onChange={() => toggle(item.id, institutionRequired)}
                    className="mt-0.5 accent-blue-500 w-4 h-4 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">{item.name}</span>
                      <StatusBadge
                        institutionRequired={institutionRequired}
                        rec={rec}
                        checked={checked}
                      />
                      {item.hasFormula && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          수식
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{item.description}</p>

                    {rec && (
                      <div className="mt-1.5 space-y-0.5">
                        <p className="text-xs text-blue-300">{rec.reason}</p>
                        <p className="text-[11px] text-slate-500">근거: {rec.matchedSection}</p>
                      </div>
                    )}
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function StatusBadge({
  institutionRequired,
  rec,
  checked,
}: {
  institutionRequired: boolean
  rec: ModuleRecommendation | undefined
  checked: boolean
}) {
  if (institutionRequired) {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">
        필수
      </span>
    )
  }

  if (rec?.status === 'required') {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30 flex items-center gap-1">
        <Sparkles size={9} />
        AI 자동 선택
      </span>
    )
  }

  if (rec?.status === 'recommended') {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1">
        <Sparkles size={9} />
        AI 추천
      </span>
    )
  }

  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
        checked
          ? 'bg-slate-600/30 text-slate-300 border-slate-500/40'
          : 'bg-slate-500/20 text-slate-400 border-slate-500/30'
      }`}
    >
      선택
    </span>
  )
}
