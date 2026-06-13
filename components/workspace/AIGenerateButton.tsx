'use client'

import { useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'

interface AIGenerateButtonProps {
  moduleId: string
  projectId: string
  keywords: string
  moduleName: string
  moduleDescription: string
  moduleCategory: string
  onGenerated: (content: string) => void
}

export default function AIGenerateButton({
  moduleId,
  projectId,
  keywords,
  moduleName,
  moduleDescription,
  moduleCategory,
  onGenerated,
}: AIGenerateButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    if (!keywords.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          moduleId,
          keywords,
          moduleMetadata: {
            name: moduleName,
            description: moduleDescription,
            category: moduleCategory,
          },
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? 'AI 초안 생성에 실패했습니다.')
      }
      const data = await res.json()
      onGenerated(data.content)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 초안 생성에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading || !keywords.trim()}
        className="cta-primary flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            생성 중...
          </>
        ) : (
          <>AI 초안 생성</>
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
