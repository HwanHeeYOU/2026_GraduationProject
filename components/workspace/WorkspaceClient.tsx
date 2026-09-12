'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import DashboardLayout from '@/components/dashboard/DashboardLayout'
import ModuleCard, { type ProjectModuleWithMeta } from './ModuleCard'
import BulkGeneratePanel from './BulkGeneratePanel'
import NetworkSyncProvider from './NetworkSyncProvider'

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
  const router = useRouter()
  const [bulkContents, setBulkContents] = useState<Record<string, string>>({})
  const [navigating, setNavigating] = useState(false)

  // 각 ModuleCard의 flushSave 함수를 등록받는 registry
  const flushRegistry = useRef<Map<string, () => Promise<void>>>(new Map())

  const registerFlush = useCallback((moduleId: string, fn: () => Promise<void>) => {
    flushRegistry.current.set(moduleId, fn)
    return () => flushRegistry.current.delete(moduleId)
  }, [])

  const handleBulkGenerated = (moduleId: string, content: string) => {
    setBulkContents((prev) => ({ ...prev, [moduleId]: content }))
  }

  // 최종검토 클릭 시 모든 미저장 내용을 즉시 저장 후 이동
  const handleReviewClick = async () => {
    setNavigating(true)
    try {
      await Promise.all(Array.from(flushRegistry.current.values()).map((fn) => fn()))
    } catch {
      // flush 실패해도 이동은 진행
    }
    window.location.href = `/projects/${projectId}/review`
  }

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
              {navigating ? '저장 중...' : '최종 검토'}
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
                />
              ))}
            </div>
          )}
        </div>
      </NetworkSyncProvider>
    </DashboardLayout>
  )
}
