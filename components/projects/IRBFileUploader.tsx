'use client'

import { useRef } from 'react'
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react'

type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'error'

interface IRBFileUploaderProps {
  files: File[]
  analysisStatus: AnalysisStatus
  analysisError?: string
  onFilesChange: (files: File[]) => void
}

const ACCEPTED = '.pdf,.docx,.txt,.hwp,.hwpx'
const MAX_SIZE_MB = 10

export default function IRBFileUploader({
  files,
  analysisStatus,
  analysisError,
  onFilesChange,
}: IRBFileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return
    const valid = Array.from(incoming).filter((f) => f.size <= MAX_SIZE_MB * 1024 * 1024)
    // 중복 제거 (이름 기준)
    const existingNames = new Set(files.map((f) => f.name))
    const newFiles = valid.filter((f) => !existingNames.has(f.name))
    if (newFiles.length > 0) onFilesChange([...files, ...newFiles])
  }

  const removeFile = (name: string) => {
    const next = files.filter((f) => f.name !== name)
    onFilesChange(next)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    addFiles(e.dataTransfer.files)
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm text-slate-200 font-medium mb-1.5">
        IRB 양식 / 가이드라인 파일 업로드
        <span className="ml-1.5 text-slate-500 font-normal">(선택, PDF·DOCX·TXT·HWP·HWPX · 여러 파일 가능)</span>
      </label>

      {/* 드롭존 — 파일이 있어도 항상 표시 */}
      <div
        className="border border-dashed border-white/20 rounded-xl p-5 text-center cursor-pointer hover:border-blue-400/50 hover:bg-white/[0.03] transition-colors"
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <Upload size={20} className="mx-auto mb-2 text-slate-500" />
        <p className="text-sm text-slate-300">클릭하거나 파일을 드래그하세요</p>
        <p className="text-xs text-slate-500 mt-0.5">PDF, DOCX, TXT, HWP, HWPX · 파일당 최대 {MAX_SIZE_MB}MB · 여러 파일 선택 가능</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
          // 같은 파일 재선택 허용
          onClick={(e) => { (e.target as HTMLInputElement).value = '' }}
        />
      </div>

      {/* 업로드된 파일 목록 */}
      {files.length > 0 && (
        <ul className="space-y-2 mt-2">
          {files.map((file) => (
            <li
              key={file.name}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                analysisStatus === 'error'
                  ? 'border-red-500/40 bg-red-500/10'
                  : analysisStatus === 'done'
                  ? 'border-green-500/40 bg-green-500/10'
                  : 'border-white/15 bg-white/5'
              }`}
            >
              <FileText size={16} className="shrink-0 text-slate-400" />

              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{file.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>

              {analysisStatus !== 'analyzing' && (
                <button
                  type="button"
                  onClick={() => removeFile(file.name)}
                  className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
                  title="파일 제거"
                >
                  <X size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 분석 상태 표시 */}
      {files.length > 0 && analysisStatus !== 'idle' && (
        <StatusLine status={analysisStatus} error={analysisError} />
      )}
    </div>
  )
}

function StatusLine({ status, error }: { status: AnalysisStatus; error?: string }) {
  if (status === 'analyzing') {
    return (
      <p className="text-xs text-blue-400 flex items-center gap-1.5 mt-1">
        <Loader2 size={11} className="animate-spin" />
        AI가 모듈을 분석하는 중입니다...
      </p>
    )
  }
  if (status === 'done') {
    return (
      <p className="text-xs text-green-400 flex items-center gap-1.5 mt-1">
        <CheckCircle2 size={11} />
        분석 완료 — 추천 모듈이 아래에 표시됩니다
      </p>
    )
  }
  if (status === 'error') {
    return (
      <p className="text-xs text-red-400 flex items-center gap-1.5 mt-1">
        <AlertCircle size={11} />
        {error ?? '분석 실패 — 기존 모듈 목록을 사용합니다'}
      </p>
    )
  }
  return null
}
