'use client'

import { useState } from 'react'
import { Download, AlertTriangle } from 'lucide-react'

interface ExportButtonProps {
  projectId: string
  projectName: string
  hasIncomplete: boolean
}

export default function ExportButton({ projectId, projectName, hasIncomplete }: ExportButtonProps) {
  const [showDialog, setShowDialog] = useState(false)
  const [pendingFormat, setPendingFormat] = useState<'docx' | 'pdf' | null>(null)
  const [loading, setLoading] = useState(false)

  async function doExport(format: 'docx' | 'pdf') {
    setLoading(true)
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, format }),
      })
      if (!res.ok) {
        alert('내보내기에 실패했습니다. 다시 시도해 주세요.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${projectName}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('내보내기에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  function handleClick(format: 'docx' | 'pdf') {
    if (hasIncomplete) {
      setPendingFormat(format)
      setShowDialog(true)
    } else {
      doExport(format)
    }
  }

  function handleConfirm() {
    setShowDialog(false)
    if (pendingFormat) doExport(pendingFormat)
  }

  function handleCancel() {
    setShowDialog(false)
    setPendingFormat(null)
  }

  return (
    <>
      <div className="flex gap-3">
        <button
          onClick={() => handleClick('docx')}
          disabled={loading}
          className="glass-button flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-white font-medium disabled:opacity-60"
        >
          <Download size={14} />
          DOCX 다운로드
        </button>
        <button
          onClick={() => handleClick('pdf')}
          disabled={loading}
          className="cta-primary flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-white font-medium disabled:opacity-60"
        >
          <Download size={14} />
          PDF 다운로드
        </button>
      </div>

      {/* 미완성 항목 확인 다이얼로그 */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle size={20} className="text-yellow-400 shrink-0" />
              <h3 className="text-white font-semibold">미완성 항목이 있습니다</h3>
            </div>
            <p className="text-slate-300 text-sm mb-6">
              일부 항목이 아직 작성되지 않았습니다. 계속 진행하시겠습니까?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCancel}
                className="glass-button px-4 py-2 rounded-lg text-sm text-slate-300"
              >
                취소
              </button>
              <button
                onClick={handleConfirm}
                className="cta-primary px-4 py-2 rounded-lg text-sm text-white font-medium"
              >
                계속 진행
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
