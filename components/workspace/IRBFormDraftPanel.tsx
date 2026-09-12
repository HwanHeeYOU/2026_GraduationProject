'use client'

import { useState, useRef } from 'react'
import { Upload, FileText, X, Loader2, CheckCircle2, AlertCircle, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { IRBFormDraftResult, IRBFormDraftOutput } from '@/lib/irb/types'

type Phase =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'form'; data: IRBFormDraftResult }
  | { status: 'generating' }
  | { status: 'done'; output: IRBFormDraftOutput }
  | { status: 'error'; message: string }

const ACCEPTED = '.pdf,.docx,.txt,.hwp,.hwpx'
const MAX_MB = 10

export default function IRBFormDraftPanel() {
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  // ── 파일 추가 ──────────────────────────────────────────────
  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return
    const existing = new Set(files.map((f) => f.name))
    const valid = Array.from(incoming).filter(
      (f) => f.size <= MAX_MB * 1024 * 1024 && !existing.has(f.name)
    )
    if (valid.length > 0) setFiles((prev) => [...prev, ...valid])
  }

  const removeFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name))
    setPhase({ status: 'idle' })
  }

  // ── Phase 1: 파일 업로드 → 문항 추출 ──────────────────────
  const handleExtract = async () => {
    if (files.length === 0) return
    setPhase({ status: 'uploading' })
    setAnswers({})

    const formData = new FormData()
    files.forEach((f) => formData.append('file', f))

    try {
      const res = await fetch('/api/ai/irb-form-draft', { method: 'POST', body: formData })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setPhase({ status: 'error', message: d.message ?? '문항 추출에 실패했습니다.' })
        return
      }
      const data: IRBFormDraftResult = await res.json()
      // 기본값으로 빈 문자열 초기화
      const init: Record<string, string> = {}
      data.questions.forEach((q) => { init[q.key] = '' })
      setAnswers(init)
      setPhase({ status: 'form', data })
      // 첫 섹션 열기
      if (data.fileSections[0]) {
        setOpenSections({ [data.fileSections[0].fileName]: true })
      }
    } catch {
      setPhase({ status: 'error', message: '서버 오류가 발생했습니다.' })
    }
  }

  // ── Phase 2: 답변 제출 → 초안 생성 ────────────────────────
  const handleGenerate = async () => {
    if (phase.status !== 'form') return
    setPhase({ status: 'generating' })

    try {
      const res = await fetch('/api/ai/irb-form-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileSections: phase.data.fileSections, answers }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setPhase({ status: 'error', message: d.message ?? '초안 생성에 실패했습니다.' })
        return
      }
      const output: IRBFormDraftOutput = await res.json()
      setPhase({ status: 'done', output })
      // 모든 섹션 열기
      const all: Record<string, boolean> = {}
      output.sections.forEach((s) => { all[s.fileName] = true })
      setOpenSections(all)
    } catch {
      setPhase({ status: 'error', message: '서버 오류가 발생했습니다.' })
    }
  }

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const toggleSection = (name: string) => {
    setOpenSections((prev) => ({ ...prev, [name]: !prev[name] }))
  }

  const handleReset = () => {
    setPhase({ status: 'idle' })
    setAnswers({})
    setFiles([])
  }

  return (
    <div className="glass-card p-5 mb-6 space-y-4">
      {/* 헤더 */}
      <div>
        <h2 className="text-sm font-semibold text-white">IRB 서류 자동 초안 생성</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          학교에서 제공한 IRB 양식 파일(PDF·DOCX·TXT·HWP)을 업로드하면, 필요한 내용을 질문하고 파일별 초안을 자동 생성해드립니다.
        </p>
      </div>

      {/* 파일 업로드 영역 */}
      {(phase.status === 'idle' || phase.status === 'error') && (
        <div className="space-y-3">
          <div
            className="border border-dashed border-white/20 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400/50 hover:bg-white/[0.03] transition-colors"
            onClick={() => inputRef.current?.click()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
            onDragOver={(e) => e.preventDefault()}
          >
            <Upload size={18} className="mx-auto mb-1.5 text-slate-500" />
            <p className="text-sm text-slate-300">IRB 양식 파일을 드래그하거나 클릭해서 추가하세요</p>
            <p className="text-xs text-slate-500 mt-0.5">PDF, DOCX, TXT, HWP, HWPX · 파일당 최대 {MAX_MB}MB · 여러 파일 가능</p>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
              onClick={(e) => { (e.target as HTMLInputElement).value = '' }}
            />
          </div>

          {/* 파일 목록 */}
          {files.length > 0 && (
            <ul className="space-y-1.5">
              {files.map((f) => (
                <li key={f.name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                  <FileText size={14} className="shrink-0 text-slate-400" />
                  <span className="flex-1 text-sm text-white truncate">{f.name}</span>
                  <span className="text-xs text-slate-500 shrink-0">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
                  <button type="button" onClick={() => removeFile(f.name)} className="shrink-0 text-slate-500 hover:text-slate-300">
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {phase.status === 'error' && (
            <p className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle size={12} />
              {phase.message}
            </p>
          )}

          <button
            onClick={handleExtract}
            disabled={files.length === 0}
            className="cta-primary px-4 py-2 rounded-lg text-sm text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            문항 분석 시작 ({files.length}개 파일)
          </button>
        </div>
      )}

      {/* 분석 중 */}
      {phase.status === 'uploading' && (
        <div className="flex items-center gap-2 text-sm text-blue-400">
          <Loader2 size={15} className="animate-spin" />
          파일을 분석하고 문항을 추출하는 중입니다...
        </div>
      )}

      {/* 폼: 질문 입력 */}
      {phase.status === 'form' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-300">
              <span className="text-white font-medium">{phase.data.questions.length}개</span>의 질문을 추출했습니다. 답변을 입력해주세요.
            </p>
            <button onClick={handleReset} className="text-xs text-slate-500 hover:text-slate-300 underline">
              처음으로
            </button>
          </div>

          {/* 파일 미리보기 (접기/펼치기) */}
          <div className="space-y-1.5">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">분석된 파일 ({phase.data.fileSections.length}개)</p>
            {phase.data.fileSections.map((sec) => (
              <div key={sec.fileName} className="rounded-lg border border-white/10 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection(sec.fileName)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-white/5 hover:bg-white/8 transition-colors text-left"
                >
                  <span className="text-xs text-slate-300 font-medium truncate">{sec.fileName}</span>
                  <span className="flex items-center gap-1.5 shrink-0 ml-2">
                    <span className="text-[10px] text-slate-500">{sec.items.length}개 문항</span>
                    {openSections[sec.fileName] ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />}
                  </span>
                </button>
                {openSections[sec.fileName] && (
                  <ul className="px-3 py-2 space-y-0.5">
                    {sec.items.map((item, i) => (
                      <li key={i} className="text-xs text-slate-400">• {item.question}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {/* 통합 질문 폼 */}
          <div className="space-y-3">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">연구 정보 입력</p>
            {phase.data.questions.map((q) => (
              <div key={q.key} className="space-y-1">
                <label className="block text-xs text-slate-200 font-medium">{q.label}</label>
                {q.multiline ? (
                  <textarea
                    value={answers[q.key] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.key]: e.target.value }))}
                    placeholder={q.placeholder}
                    rows={3}
                    className="glass-input w-full px-3 py-2 rounded-lg text-sm text-white placeholder-slate-500 outline-none resize-y"
                  />
                ) : (
                  <input
                    type="text"
                    value={answers[q.key] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.key]: e.target.value }))}
                    placeholder={q.placeholder}
                    className="glass-input w-full px-3 py-2 rounded-lg text-sm text-white placeholder-slate-500 outline-none"
                  />
                )}
              </div>
            ))}
          </div>

          <button
            onClick={handleGenerate}
            className="cta-primary px-4 py-2 rounded-lg text-sm text-white font-medium"
          >
            초안 생성하기
          </button>
        </div>
      )}

      {/* 초안 생성 중 */}
      {phase.status === 'generating' && (
        <div className="flex items-center gap-2 text-sm text-blue-400">
          <Loader2 size={15} className="animate-spin" />
          AI가 파일별 초안을 작성하는 중입니다...
        </div>
      )}

      {/* 결과 출력 */}
      {phase.status === 'done' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 size={13} />
              {phase.output.sections.length}개 파일의 초안이 생성되었습니다.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCopy(phase.output.rawText)}
                className="flex items-center gap-1.5 text-xs glass-button px-3 py-1.5 rounded-lg text-slate-300"
              >
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                {copied ? '복사됨' : '전체 복사'}
              </button>
              <button onClick={handleReset} className="text-xs text-slate-500 hover:text-slate-300 underline">
                처음으로
              </button>
            </div>
          </div>

          {/* 파일별 섹션 */}
          {phase.output.sections.map((sec) => (
            <div key={sec.fileName} className="rounded-xl border border-white/12 overflow-hidden">
              {/* 파일 헤더 */}
              <button
                type="button"
                onClick={() => toggleSection(sec.fileName)}
                className="w-full flex items-center justify-between px-4 py-3 bg-blue-600/15 hover:bg-blue-600/20 transition-colors text-left"
              >
                <span className="text-sm font-semibold text-blue-200 truncate">{sec.fileName}</span>
                <span className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-xs text-slate-400">{sec.items.length}개 문항</span>
                  {openSections[sec.fileName]
                    ? <ChevronUp size={14} className="text-slate-400" />
                    : <ChevronDown size={14} className="text-slate-400" />}
                </span>
              </button>

              {openSections[sec.fileName] && (
                <div className="divide-y divide-white/8">
                  {sec.items.map((item, idx) => (
                    <div key={idx} className="px-4 py-3 space-y-1.5">
                      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-white/10 text-[10px] text-slate-400 font-bold">Q</span>
                        {item.question}
                      </p>
                      <div className="relative group">
                        <p className="text-sm text-white leading-relaxed whitespace-pre-wrap bg-white/[0.03] rounded-lg px-3 py-2.5 pr-9">
                          {item.answer}
                        </p>
                        <button
                          onClick={() => handleCopy(item.answer)}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-slate-300"
                          title="복사"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
