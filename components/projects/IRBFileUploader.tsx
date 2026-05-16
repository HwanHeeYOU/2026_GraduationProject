'use client'

import { useRef } from 'react'
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react'

type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'error'

interface IRBFileUploaderProps {
  file: File | null
  analysisStatus: AnalysisStatus
  analysisError?: string
  onFileChange: (file: File | null) => void
}

const ACCEPTED = '.pdf,.docx,.txt'

export default function IRBFileUploader({
  file,
  analysisStatus,
  analysisError,
  onFileChange,
}: IRBFileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    onFileChange(files[0])
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm text-slate-300 mb-1.5">
        IRB 양식 / 가이드라인 파일 업로드
        <span className="ml-1.5 text-slate-500 font-normal">(선택, PDF·DOCX·TXT)</span>
      </label>

      {!file ? (
        <div
          className="border border-dashed border-white/20 rounded-xl p-5 text-center cursor-pointer hover:border-blue-400/50 hover:bg-white/[0.03] transition-colors"
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <Upload size={20} className="mx-auto mb-2 text-slate-500" />
          <p className="text-sm text-slate-400">클릭하거나 파일을 드래그하세요</p>
          <p className="text-xs text-slate-600 mt-0.5">PDF, DOCX, TXT · 최대 10MB</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      ) : (
        <div
          className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
            analysisStatus === 'error'
              ? 'border-red-500/40 bg-red-500/10'
              : analysisStatus === 'done'
              ? 'border-green-500/40 bg-green-500/10'
              : 'border-white/15 bg-white/5'
          }`}
        >
          <FileText size={18} className="shrink-0 text-slate-400" />

          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">{file.name}</p>
            <StatusLine status={analysisStatus} error={analysisError} />
          </div>

          {analysisStatus !== 'analyzing' && (
            <button
              type="button"
              onClick={() => onFileChange(null)}
              className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
              title="파일 제거"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function StatusLine({ status, error }: { status: AnalysisStatus; error?: string }) {
  if (status === 'idle') return null

  if (status === 'analyzing') {
    return (
      <p className="text-xs text-blue-400 flex items-center gap-1 mt-0.5">
        <Loader2 size={11} className="animate-spin" />
        AI가 모듈을 분석하는 중입니다...
      </p>
    )
  }

  if (status === 'done') {
    return (
      <p className="text-xs text-green-400 flex items-center gap-1 mt-0.5">
        <CheckCircle2 size={11} />
        분석 완료 — 추천 모듈이 아래에 표시됩니다
      </p>
    )
  }

  return (
    <p className="text-xs text-red-400 flex items-center gap-1 mt-0.5">
      <AlertCircle size={11} />
      {error ?? '분석 실패 — 기존 모듈 목록을 사용합니다'}
    </p>
  )
}
