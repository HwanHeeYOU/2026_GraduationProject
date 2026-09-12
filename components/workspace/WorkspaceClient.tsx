'use client'

import { useState, useRef, useCallback } from 'react'
import { ArrowRight } from 'lucide-react'
import DashboardLayout from '@/components/dashboard/DashboardLayout'
import ModuleCard, { type ProjectModuleWithMeta } from './ModuleCard'
import BulkGeneratePanel from './BulkGeneratePanel'
import NetworkSyncProvider from './NetworkSyncProvider'

const SESSION_KEY = 'irb_research_description'

interface WorkspaceClientProps {
  projectId: string
  projectName: string
  institutionName: string
  modules: ProjectModuleWithMeta[]
  userName?: string | null
}

export default function WorkspaceClient({
  projectId,
  projectName,
  institutionName,
  modules,
  userName,
}: WorkspaceClientProps) {
  const [bulkContents, setBulkContents] = useState<Record<string, string>>({})
  const [navigating, setNavigating] = useState(false)
  const [navStep, setNavStep] = useState<'idle' | 'saving' | 'summarizing'>('idle')

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

  const handleBulkGenerated = (moduleId: string, content: string) => {
    setBulkContents((prev) => ({ ...prev, [moduleId]: content }))
  }

  const handleReviewClick = async () => {
    setNavigating(true)
    setNavStep('saving')

    // Step 1: 모든 모듈 즉시 저장
    try {
      await Promise.all(Array.from(flushRegistry.current.values()).map((fn) => fn()))
    } catch {
      // 저장 실패해도 계속 진행
    }

    // Step 2: 현재 모든 모듈 내용 수집
    const moduleContents = modules.map((mod) => {
      const getContent = contentRegistry.current.get(mod.id)
      return {
        name: mod.module.name,
        content: getContent ? getContent() : mod.content,
      }
    }).filter((m) => m.content.trim().length > 0)

    // Step 3: 내용이 있으면 AI 요약 → sessionStorage 저장
    if (moduleContents.length > 0) {
      setNavStep('summarizing')
      try {
        const res = await fetch('/api/ai/summarize-modules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modules: moduleContents }),
        })
        if (res.ok) {
          const data = await res.json() as { summary: string }
          if (data.summary) {
            try { sessionStorage.setItem(SESSION_KEY, data.summary) } catch {}
          }
        }
      } catch {
        // 요약 실패해도 이동은 진행 — 기존 sessionStorage 값 유지
      }
    }

    window.location.href = `/projects/${projectId}/review`
  }

  const navLabel =
    navStep === 'saving' ? '저장 중...' :
    navStep === 'summarizing' ? '내용 정리 중...' :
    '최종 검토'

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
              onClick={handleReviewClick}
              disabled={navigating}
              className="cta-primary flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-white font-medium shrink-0 disabled:opacity-60"
            >
              {navLabel}
              <ArrowRight size={14} />
            </button>
          </div>

          {/* 실험 설명으로 전체 모듈 일괄 생성 */}
          {modules.length > 0 && (
            <BulkGeneratePanel
              modules={modules}
              projectId={projectId}
              onGenerated={handleBulkGenerated}
            />
          )}

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
