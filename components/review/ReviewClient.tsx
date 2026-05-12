'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import DashboardLayout from '@/components/dashboard/DashboardLayout'
import ExportButton from './ExportButton'

interface ReviewModule {
  id: string
  content: string
  order: number
  module: {
    name: string
    category: string
  }
}

interface ReviewClientProps {
  projectId: string
  projectName: string
  institutionName: string
  modules: ReviewModule[]
  userName?: string | null
}

export default function ReviewClient({
  projectId,
  projectName,
  institutionName,
  modules,
  userName,
}: ReviewClientProps) {
  const [contents, setContents] = useState<Record<string, string>>(
    Object.fromEntries(modules.map((m) => [m.id, m.content]))
  )

  const sorted = [...modules].sort((a, b) => a.order - b.order)
  const hasIncomplete = sorted.some((m) => (contents[m.id] ?? '').trim() === '')

  function handleChange(id: string, value: string) {
    setContents((prev) => ({ ...prev, [id]: value }))
  }

  return (
    <DashboardLayout userName={userName}>
      <div className="night-campus-bg min-h-full py-6 px-4">
        {/* 상단 헤더 */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <Link
              href={`/projects/${projectId}/workspace`}
              className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-sm mb-2 transition-colors"
            >
              <ArrowLeft size={14} />
              워크스페이스로 돌아가기
            </Link>
            <h1 className="text-xl font-bold text-white">{projectName}</h1>
            <p className="text-sm text-slate-400 mt-0.5">{institutionName}</p>
          </div>
          <ExportButton
            projectId={projectId}
            projectName={projectName}
            hasIncomplete={hasIncomplete}
          />
        </div>

        {/* 미완성 항목 경고 배너 */}
        {hasIncomplete && (
          <div className="mb-4 px-4 py-3 rounded-xl border border-yellow-500/40 bg-yellow-500/10 text-yellow-300 text-sm">
            미완성 항목이 있습니다. 모든 항목을 작성한 후 내보내기를 권장합니다.
          </div>
        )}

        {/* 모듈 목록 */}
        <div className="flex flex-col gap-4">
          {sorted.map((mod) => {
            const value = contents[mod.id] ?? ''
            const incomplete = value.trim() === ''
            return (
              <div
                key={mod.id}
                className={`glass-card p-5 ${incomplete ? 'border-red-500/60 bg-red-500/5' : ''}`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-white font-semibold text-base">{mod.module.name}</h2>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 border border-blue-500/40 text-blue-300">
                    {mod.module.category}
                  </span>
                  {incomplete && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 border border-red-500/40 text-red-400">
                      미완성
                    </span>
                  )}
                </div>
                <textarea
                  value={value}
                  onChange={(e) => handleChange(mod.id, e.target.value)}
                  rows={5}
                  className="w-full glass-input rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-500 resize-y"
                  placeholder="내용을 입력하세요..."
                />
              </div>
            )
          })}
        </div>
      </div>
    </DashboardLayout>
  )
}
