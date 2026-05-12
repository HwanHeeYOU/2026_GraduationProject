'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import DashboardLayout from '@/components/dashboard/DashboardLayout'
import ModuleCard, { type ProjectModuleWithMeta } from './ModuleCard'
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
  return (
    <DashboardLayout userName={userName}>
      <NetworkSyncProvider>
        <div className="night-campus-bg min-h-full py-6 px-4">
          {/* 상단 헤더 */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl font-bold text-white">{projectName}</h1>
              <p className="text-sm text-slate-400 mt-0.5">{institutionName}</p>
            </div>
            <Link
              href={`/projects/${projectId}/review`}
              className="cta-primary flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-white font-medium shrink-0"
            >
              최종 검토
              <ArrowRight size={14} />
            </Link>
          </div>

          {/* 모듈 카드 그리드 */}
          {modules.length === 0 ? (
            <div className="glass-card p-8 text-center text-slate-400 text-sm">
              선택된 모듈이 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {modules.map((mod) => (
                <ModuleCard key={mod.id} module={mod} projectId={projectId} />
              ))}
            </div>
          )}
        </div>
      </NetworkSyncProvider>
    </DashboardLayout>
  )
}
