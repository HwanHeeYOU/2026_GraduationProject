'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, ChevronDown, AlertCircle } from 'lucide-react'

interface Institution {
  id: string
  name: string
  shortName?: string | null
}

interface InstitutionSelectorProps {
  onSelect: (institution: Institution) => void
  selected?: Institution | null
}

export default function InstitutionSelector({ onSelect, selected }: InstitutionSelectorProps) {
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fetchInstitutions = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/institutions')
        if (!res.ok) throw new Error('fetch failed')
        const data = await res.json()
        setInstitutions(data)
      } catch {
        setError('학교 정보를 불러오는 데 실패했습니다. 다시 시도해 주세요.')
      } finally {
        setLoading(false)
      }
    }
    fetchInstitutions()
  }, [])

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filtered = institutions.filter(
    (inst) =>
      inst.name.toLowerCase().includes(query.toLowerCase()) ||
      (inst.shortName ?? '').toLowerCase().includes(query.toLowerCase())
  )

  const handleSelect = (inst: Institution) => {
    onSelect(inst)
    setQuery('')
    setOpen(false)
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-400 text-sm">
        <AlertCircle size={16} className="shrink-0" />
        <span>{error}</span>
        <button
          onClick={() => window.location.reload()}
          className="ml-auto underline text-red-300 hover:text-red-200 text-xs"
        >
          다시 시도
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      {/* 선택 버튼 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="glass-input w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm text-left"
        disabled={loading}
      >
        <span className={selected ? 'text-white' : 'text-slate-400'}>
          {loading ? '학교 목록 불러오는 중...' : selected ? selected.name : '학교를 선택하세요'}
        </span>
        <ChevronDown
          size={16}
          className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* 드롭다운 */}
      {open && (
        <div className="absolute z-50 mt-2 w-full glass-card rounded-xl overflow-hidden shadow-xl">
          {/* 검색 입력 */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="학교 검색..."
              className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
            />
          </div>

          {/* 목록 */}
          <ul className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-slate-400 text-center">검색 결과가 없습니다.</li>
            ) : (
              filtered.map((inst) => (
                <li key={inst.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(inst)}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-white/10 transition-colors flex items-center justify-between"
                  >
                    <span>{inst.name}</span>
                    {inst.shortName && (
                      <span className="text-xs text-slate-500">{inst.shortName}</span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
