'use client'

import { useState, useEffect } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

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
}

export default function ModuleSelector({ institutionId, selectedIds, onChange }: ModuleSelectorProps) {
  const [items, setItems] = useState<ModuleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchModules = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/institutions/${institutionId}/modules`)
      if (!res.ok) throw new Error('fetch failed')
      const data: { modules: ModuleItem[] } = await res.json()
      setItems(data.modules)

      // 필수 모듈은 기본 선택 상태
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

  // 카테고리별 그룹핑
  const grouped = items.reduce<Record<string, ModuleItem[]>>((acc, item) => {
    const cat = item.category
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([category, groupItems]) => (
        <div key={category}>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
            {category}
          </h3>
          <div className="space-y-2">
            {groupItems.map((item) => {
              const checked = selectedIds.includes(item.id)
              const required = item.institutionIsRequired
              return (
                <label
                  key={item.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                    checked
                      ? 'border-blue-500/40 bg-blue-500/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/[0.08]'
                  } ${required ? 'cursor-default' : 'cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={required}
                    onChange={() => toggle(item.id, required)}
                    className="mt-0.5 accent-blue-500 w-4 h-4 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">{item.name}</span>
                      {required ? (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">
                          필수
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-500/20 text-slate-400 border border-slate-500/30">
                          선택
                        </span>
                      )}
                      {item.hasFormula && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          수식
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{item.description}</p>
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
