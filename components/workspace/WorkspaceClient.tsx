'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { ArrowRight, FileText } from 'lucide-react'
import DashboardLayout from '@/components/dashboard/DashboardLayout'
import ModuleCard, { type ProjectModuleWithMeta } from './ModuleCard'
import IRBFormDraftPanel from './IRBFormDraftPanel'
import NetworkSyncProvider from './NetworkSyncProvider'
import RejectionPanel, { type RejectionNote } from './RejectionPanel'
import type { IRBFormDraftResult, IRBUserInput } from '@/lib/irb/types'

const SESSION_KEY_DRAFT = 'irb_form_draft_output'
const SESSION_KEY_INCOMPLETE = 'irb_incomplete_keys'

interface WorkspaceClientProps {
  projectId: string
  projectName: string
  institutionName: string
  modules: ProjectModuleWithMeta[]
  rejectionNotes: RejectionNote[]
  sourceSummary?: string | null
  initialFormDraft?: IRBFormDraftResult
  /** 이전에 입력했던 정보 (돌아왔을 때 폼을 채워서 보여줌) */
  initialUserInput?: IRBUserInput
  userName?: string | null
}

export default function WorkspaceClient({
  projectId,
  projectName,
  institutionName,
  modules,
  rejectionNotes: initialRejectionNotes,
  initialFormDraft,
  initialUserInput,
  userName,
}: WorkspaceClientProps) {
  const [bulkContents, setBulkContents] = useState<Record<string, string>>({})
  const [rejectionNotes, setRejectionNotes] = useState<RejectionNote[]>(initialRejectionNotes)
  const [navigating, setNavigating] = useState(false)
  // 리뷰 페이지에서 전달된 미완 항목 (question 텍스트 기반)
  const [incompleteQuestions, setIncompleteQuestions] = useState<string[]>([])

  // 각 ModuleCard의 flushSave / getContent 함수 registry
  const flushRegistry = useRef<Map<string, () => Promise<void>>>(new Map())
  const contentRegistry = useRef<Map<string, () => string>>(new Map())

  const registerFlush = useCallback((moduleId: string, fn: () => Promise<void>) => {
    flushRegistry.current.set(moduleId, fn)
    return () => flushRegistry.current.delete(moduleId)
  }, [])

  const registerGetContent = useCallback((moduleId: string, fn: () => string) => {
    contentRegistry.current.set(moduleId, fn)
    return () => contentRegistry.current.delete(moduleId)
  }, [])

  const unresolvedNoteByModule = new Map<string, RejectionNote>()
  for (const note of rejectionNotes) {
    if (!note.resolved && note.projectModuleId && !unresolvedNoteByModule.has(note.projectModuleId)) {
      unresolvedNoteByModule.set(note.projectModuleId, note)
    }
  }

  // 마운트 시 리뷰에서 저장한 미완 항목 읽기
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY_INCOMPLETE)
      if (raw) {
        const keys = JSON.parse(raw) as string[]
        if (Array.isArray(keys) && keys.length > 0) {
          setIncompleteQuestions(keys)
          // 읽고 나면 지움 — 한 번만 표시
          sessionStorage.removeItem(SESSION_KEY_INCOMPLETE)
        }
      }
    } catch {
      // 무시
    }
  }, [])

  // 초안 생성 전 모든 모듈 카드 내용을 DB 에 저장 (서버가 이 내용을 AI 프롬프트에 사용)
  const flushAllModules = useCallback(async () => {
    await Promise.all(Array.from(flushRegistry.current.values()).map((fn) => fn()))
  }, [])

  // IRB 초안 생성 완료 → sessionStorage 저장 후 /review로 이동
  const handleDraftComplete = useCallback(async (rawText: string, sectionsJson: string) => {
    setNavigating(true)
    try {
      // 생성 결과를 sessionStorage에 저장
      try {
        sessionStorage.setItem(SESSION_KEY_DRAFT, sectionsJson)
      } catch {
        // sessionStorage 실패해도 이동은 진행
      }
      // 모든 모듈 저장
      await Promise.all(Array.from(flushRegistry.current.values()).map((fn) => fn())).catch(() => {})
    } finally {
      window.location.href = `/projects/${projectId}/review`
    }
  }, [projectId])

  return (
    <DashboardLayout userName={userName}>
      <NetworkSyncProvider>
        <div className="py-2">
          {/* 상단 헤더 */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl font-bold text-white">{projectName}</h1>
              <p className="text-sm text-slate-400 mt-0.5">{institutionName}</p>
            </div>
            <button
              onClick={() => { setNavigating(true); window.location.href = `/projects/${projectId}/review` }}
              disabled={navigating}
              className="glass-button flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-slate-300 font-medium shrink-0 disabled:opacity-60"
            >
              {navigating ? '이동 중...' : '최종 검토'}
              <ArrowRight size={14} />
            </button>
          </div>

          {/* IRB 반려 사유 관리 */}
          <RejectionPanel
            projectId={projectId}
            moduleOptions={modules.map((m) => ({ id: m.id, name: m.module.name }))}
            notes={rejectionNotes}
            onNotesChange={setRejectionNotes}
          />

          {/* IRB 서식 자동 초안 생성 — 유일한 초안 생성 진입점 */}
          <div className="glass-card p-5 mb-6 space-y-3">
            <div className="flex items-center gap-2">
              <FileText size={15} className="text-blue-400" />
              <h2 className="text-sm font-semibold text-white">IRB 서식 자동 초안 생성</h2>
            </div>
            <p className="text-xs text-slate-400">
              업로드한 IRB 원본 서식 파일의 각 문항에 맞게 정보를 매핑하여 파일별 초안을 생성합니다.
              생성 완료 후 자동으로 최종 검토 페이지로 이동합니다.
            </p>
            <IRBFormDraftPanel
              initialFormDraft={initialFormDraft}
              initialUserInput={initialUserInput}
              embedded
              onDraftComplete={handleDraftComplete}
              beforeGenerate={flushAllModules}
              incompleteQuestions={incompleteQuestions}
              projectId={projectId}
            />
          </div>

          {/* 모듈 카드 그리드 */}
          {modules.length === 0 ? (
            <div className="glass-card p-8 text-center text-slate-400 text-sm">
              선택된 모듈이 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {modules.map((mod) => (
                <ModuleCard
                  key={mod.id}
                  module={mod}
                  projectId={projectId}
                  externalContent={bulkContents[mod.id]}
                  rejectionNote={unresolvedNoteByModule.get(mod.id)}
                  onRegisterFlush={registerFlush}
                  onRegisterGetContent={registerGetContent}
                />
              ))}
            </div>
          )}
        </div>
      </NetworkSyncProvider>
    </DashboardLayout>
  )
}
