'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2, Trash2, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'

export interface RejectionNote {
  id: string
  projectModuleId: string | null
  reason: string
  resolved: boolean
  createdAt: string
}

interface RejectionPanelProps {
  projectId: string
  moduleOptions: { id: string; name: string }[]
  notes: RejectionNote[]
  onNotesChange: (notes: RejectionNote[]) => void
}

export default function RejectionPanel({ projectId, moduleOptions, notes, onNotesChange }: RejectionPanelProps) {
  const [expanded, setExpanded] = useState(true)
  const [reason, setReason] = useState('')
  const [targetModuleId, setTargetModuleId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const unresolvedCount = notes.filter((n) => !n.resolved).length

  const moduleName = (id: string | null) =>
    id ? moduleOptions.find((m) => m.id === id)?.name ?? '알 수 없는 모듈' : '전체 서류 공통'

  const handleAdd = async () => {
    const trimmed = reason.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/rejections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: trimmed, projectModuleId: targetModuleId || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? '반려 사유 등록에 실패했습니다.')
      }
      const note = await res.json() as RejectionNote
      onNotesChange([note, ...notes])
      setReason('')
      setTargetModuleId('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '반려 사유 등록에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleResolveToggle = async (note: RejectionNote) => {
    setBusyId(note.id)
    try {
      const res = await fetch(`/api/projects/${projectId}/rejections/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: !note.resolved }),
      })
      if (!res.ok) return
      const updated = await res.json() as RejectionNote
      onNotesChange(notes.map((n) => (n.id === note.id ? updated : n)))
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (noteId: string) => {
    setBusyId(noteId)
    try {
      const res = await fetch(`/api/projects/${projectId}/rejections/${noteId}`, { method: 'DELETE' })
      if (!res.ok) return
      onNotesChange(notes.filter((n) => n.id !== noteId))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="glass-card p-5 mb-6 border-red-500/30">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-400" />
          <h2 className="text-white font-semibold text-sm">IRB 반려 사유 관리</h2>
          {unresolvedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 border border-red-500/40 text-red-400">
              미해결 {unresolvedCount}건
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-400">
            IRB 심의위원회로부터 받은 반려 사유를 입력하면, 해당 항목에서 AI가 반려 사유를 반영해 내용을 재작성할 수 있습니다.
          </p>

          {/* 입력 폼 */}
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={targetModuleId}
                onChange={(e) => setTargetModuleId(e.target.value)}
                className="glass-input px-3 py-2 rounded-lg text-sm text-white outline-none sm:w-56 shrink-0"
              >
                <option value="">전체 서류 공통</option>
                {moduleOptions.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
                placeholder="심의위원회 반려 사유를 입력하세요..."
                className="glass-input flex-1 px-3 py-2 rounded-lg text-sm text-white placeholder-slate-500 outline-none"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={submitting || !reason.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : '등록'}
              </button>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>

          {/* 목록 */}
          {notes.length > 0 && (
            <div className="flex flex-col gap-2">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${
                    note.resolved
                      ? 'border-slate-600/40 bg-slate-800/30 opacity-60'
                      : 'border-red-500/30 bg-red-500/5'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        {moduleName(note.projectModuleId)}
                      </span>
                      {note.resolved && (
                        <span className="text-[11px] text-green-400 flex items-center gap-1">
                          <CheckCircle2 size={11} /> 해결됨
                        </span>
                      )}
                    </div>
                    <p className={`text-sm ${note.resolved ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                      {note.reason}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleResolveToggle(note)}
                      disabled={busyId === note.id}
                      title={note.resolved ? '미해결로 되돌리기' : '해결됨으로 표시'}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-green-400 hover:bg-white/5 disabled:opacity-40"
                    >
                      <CheckCircle2 size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(note.id)}
                      disabled={busyId === note.id}
                      title="삭제"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-white/5 disabled:opacity-40"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
