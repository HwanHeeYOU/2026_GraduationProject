'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, AlertCircle, CheckCircle2 } from 'lucide-react'

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
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

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

  const filtered = query.trim()
    ? institutions.filter(
        (inst) =>
          inst.name.toLowerCase().includes(query.toLowerCase()) ||
          (inst.shortName ?? '').toLowerCase().includes(query.toLowerCase())
      )
    : []

  // 활성 항목이 범위를 벗어나지 않도록 보정
  const clampedIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0))

  const handleSelect = useCallback(
    (inst: Institution) => {
      onSelect(inst)
      setQuery('')
      setOpen(false)
      inputRef.current?.blur()
    },
    [onSelect]
  )

  const handleClear = () => {
    setQuery('')
    setOpen(false)
    onSelect(null as unknown as Institution) // 선택 해제
    inputRef.current?.focus()
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    setActiveIndex(0)
    setOpen(val.trim().length > 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || filtered.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
        scrollActiveIntoView(Math.min(clampedIndex + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
        scrollActiveIntoView(Math.max(clampedIndex - 1, 0))
        break
      case 'Tab':
      case 'Enter':
        e.preventDefault()
        if (filtered[clampedIndex]) handleSelect(filtered[clampedIndex])
        break
      case 'Escape':
        setOpen(false)
        break
    }
  }

  const scrollActiveIntoView = (index: number) => {
    const list = listRef.current
    if (!list) return
    const item = list.children[index] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
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
      {/* 선택된 학교 표시 */}
      {selected && !open ? (
        <div className="glass-input w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-blue-400 shrink-0" />
            <span className="text-white font-medium">{selected.name}</span>
            {selected.shortName && (
              <span className="text-slate-500 text-xs">{selected.shortName}</span>
            )}
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="text-slate-500 hover:text-slate-300 transition-colors ml-2"
            aria-label="선택 취소"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        /* 검색 입력창 */
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => query.trim() && setOpen(true)}
            placeholder={loading ? '학교 목록 불러오는 중...' : '학교명을 입력하세요 (예: 연세, 가톨릭)'}
            disabled={loading}
            autoComplete="off"
            className="glass-input w-full pl-9 pr-4 py-3 rounded-xl text-sm text-white placeholder-slate-500 outline-none disabled:opacity-50"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setOpen(false) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              aria-label="지우기"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* 자동완성 드롭다운 */}
      {open && (
        <div className="absolute z-50 mt-1.5 w-full glass-card rounded-xl overflow-hidden shadow-xl border border-white/10">
          <ul ref={listRef} className="max-h-56 overflow-y-auto py-1" role="listbox">
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-slate-400 text-center">
                검색 결과가 없습니다.
              </li>
            ) : (
              filtered.map((inst, i) => {
                const isActive = i === clampedIndex
                // 매칭 부분 하이라이트
                const highlight = (text: string) => {
                  const idx = text.toLowerCase().indexOf(query.toLowerCase())
                  if (idx === -1) return <span>{text}</span>
                  return (
                    <>
                      {text.slice(0, idx)}
                      <mark className="bg-blue-500/30 text-blue-200 rounded-sm not-italic">
                        {text.slice(idx, idx + query.length)}
                      </mark>
                      {text.slice(idx + query.length)}
                    </>
                  )
                }

                return (
                  <li key={inst.id} role="option" aria-selected={isActive}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()} // blur 방지
                      onClick={() => handleSelect(inst)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between gap-3 ${
                        isActive
                          ? 'bg-blue-500/20 text-white'
                          : 'text-slate-200 hover:bg-white/8'
                      }`}
                    >
                      <span>{highlight(inst.name)}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {inst.shortName && (
                          <span className="text-xs text-slate-500">{inst.shortName}</span>
                        )}
                        {isActive && (
                          <span className="text-[10px] text-slate-500 border border-white/15 rounded px-1 py-0.5 leading-none">
                            Tab
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
          {filtered.length > 0 && (
            <div className="px-4 py-2 border-t border-white/8 flex items-center gap-3 text-[11px] text-slate-600">
              <span>↑↓ 이동</span>
              <span>Tab / Enter 선택</span>
              <span>Esc 닫기</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
