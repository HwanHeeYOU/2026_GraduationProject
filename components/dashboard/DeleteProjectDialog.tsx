'use client'

import { useState } from 'react'
import { Trash2, X } from 'lucide-react'

interface DeleteProjectDialogProps {
  projectName: string
  onConfirm: () => Promise<void>
}

export default function DeleteProjectDialog({ projectName, onConfirm }: DeleteProjectDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await onConfirm()
    } finally {
      setLoading(false)
      setOpen(false)
    }
  }

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        className="glass-button p-2 rounded-lg text-slate-400 hover:text-red-400 transition-colors"
        aria-label="프로젝트 삭제"
      >
        <Trash2 size={14} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="glass-card p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">프로젝트 삭제</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-slate-300 text-sm mb-6">
              <span className="text-white font-medium">&ldquo;{projectName}&rdquo;</span> 프로젝트를 삭제하시겠습니까?
              <br />
              <span className="text-red-400 text-xs mt-1 block">이 작업은 되돌릴 수 없습니다.</span>
            </p>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setOpen(false)}
                className="glass-button px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-sm bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 hover:text-red-300 transition-colors disabled:opacity-50"
              >
                {loading ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
