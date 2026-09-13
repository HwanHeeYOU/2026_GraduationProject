'use client'

import { useState } from 'react'
import { Loader2, AlertCircle, Wand2 } from 'lucide-react'

interface ReviseFromRejectionButtonProps {
  projectId: string
  projectModuleId: string
  currentContent: string
  rejectionReason: string
  moduleName: string
  moduleDescription: string
  moduleCategory: string
  onRevised: (content: string) => void
}

export default function ReviseFromRejectionButton({
  projectId,
  projectModuleId,
  currentContent,
  rejectionReason,
  moduleName,
  moduleDescription,
  moduleCategory,
  onRevised,
}: ReviseFromRejectionButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRevise = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          projectModuleId,
          currentContent,
          rejectionReason,
          moduleMetadata: {
            name: moduleName,
            description: moduleDescription,
            category: moduleCategory,
          },
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? 'AI 수정에 실패했습니다.')
      }
      const data = await res.json()
      onRevised(data.content)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 수정에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleRevise}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            반려 사유 반영 중...
          </>
        ) : (
          <>
            <Wand2 size={14} />
            반려 사유로 AI 재작성
          </>
        )}
      </button>
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle size={12} />
          {error}
        </p>
      )}
    </div>
  )
}
