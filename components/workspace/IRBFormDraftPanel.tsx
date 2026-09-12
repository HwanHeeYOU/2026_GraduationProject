'use client'

import { useState, useRef, useEffect } from 'react'
import { Upload, FileText, X, Loader2, CheckCircle2, AlertCircle, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { IRBFormDraftOutput } from '@/lib/irb/types'

type Phase =
  | { status: 'idle' }
  | { status: 'extracting' }
  | { status: 'generating'; completed: number; total: number }
  | { status: 'done'; output: IRBFormDraftOutput }
  | { status: 'error'; message: string }

const ACCEPTED = '.pdf,.docx,.txt,.hwp,.hwpx'
const MAX_MB = 10
const SESSION_KEY = 'irb_research_description'

export default function IRBFormDraftPanel() {
  const [files, setFiles] = useState<File[]>([])
  const [description, setDescription] = useState('')
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  // 워크스페이스에서 입력한 연구 설명 자동 주입
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY)
      if (saved) setDescription(saved)
    } catch {}
  }, [])

  // ── 파일 관리 ────────────────────────────────────────────
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
    if (phase.status !== 'idle') setPhase({ status: 'idle' })
  }

  // ── 메인: 파일 분석 → AI 초안 생성 ──────────────────────
  const handleGenerate = async () => {
    if (files.length === 0 || !description.trim()) return

    // Step 1: 파일 → 문항 추출
    setPhase({ status: 'extracting' })
    const formData = new FormData()
    files.forEach((f) => formData.append('file', f))

    try {
      const res1 = await fetch('/api/ai/irb-form-draft', { method: 'POST', body: formData })
      if (!res1.ok) {
        const d = await res1.json().catch(() => ({}))
        setPhase({ status: 'error', message: (d as {message?:string}).message ?? '문항 추출에 실패했습니다.' })
        return
      }
      const extracted = await res1.json() as import('@/lib/irb/types').IRBFormDraftResult

      // Step 2: 연구 설명 → 파일별 초안 생성
      setPhase({ status: 'generating', completed: 0, total: extracted.fileSections.length })
      const res2 = await fetch('/api/ai/irb-form-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileSections: extracted.fileSections,
          researchDescription: description,
        }),
      })
      if (!res2.ok) {
        const d = await res2.json().catch(() => ({}))
        setPhase({ status: 'error', message: (d as {message?:string}).message ?? '초안 생성에 실패했습니다.' })
        return
      }
      const output = await res2.json() as IRBFormDraftOutput
      setPhase({ status: 'done', output })

      // 모든 섹션 펼치기
      const all: Record<string, boolean> = {}
      output.sections.forEach((s) => { all[s.fileName] = true })
      setOpenSections(all)
    } catch (e) {
      setPhase({ status: 'error', message: '서버 오류가 발생했습니다. 다시 시도해주세요.' })
    }
  }

  const handleCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const handleReset = () => {
    setPhase({ status: 'idle' })
    setFiles([])
    setOpenSections({})
  }

  const isRunning = phase.status === 'extracting' || phase.status === 'generating'

  // [작성 필요: 추가 정보 입력 요망] 를 붉은색으로 강조
  const MISSING = '[작성 필요: 추가 정보 입력 요망]'
  const renderAnswer = (text: string) => {
    if (!text) return <span className="text-slate-500 italic">생성된 답변이 없습니다.</span>
    const parts = text.split(MISSING)
    if (parts.length === 1) return <span>{text}</span>
    return (
      <>
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < parts.length - 1 && (
              <span className="text-red-400 font-semibold bg-red-500/10 rounded px-1 py-0.5 text-xs">
                {MISSING}
              </span>
            )}
          </span>
        ))}
      </>
    )
  }

  return (
    <div className="glass-card p-5 mb-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">IRB 서류 자동 초안 생성</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          학교에서 받은 IRB 빈 양식 파일을 업로드하면, 연구 설명을 바탕으로 각 문항의 답변을 자동 생성합니다.
        </p>
      </div>

      {/* ── 입력 영역 ── */}
      {(phase.status === 'idle' || phase.status === 'error') && (
        <div className="space-y-4">

          {/* ① 파일 업로드 */}
          <div>
            <p className="text-xs text-slate-300 font-medium mb-2">
              ① IRB 빈 양식 파일 업로드
              <span className="ml-1 text-slate-500 font-normal">(처음 단계에서 올린 파일을 다시 업로드하세요)</span>
            </p>
            <div
              className="border border-dashed border-white/20 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400/50 hover:bg-white/[0.03] transition-colors"
              onClick={() => inputRef.current?.click()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
              onDragOver={(e) => e.preventDefault()}
            >
              <Upload size={16} className="mx-auto mb-1 text-slate-500" />
              <p className="text-sm text-slate-300">파일 드래그 또는 클릭</p>
              <p className="text-xs text-slate-500 mt-0.5">PDF · DOCX · TXT · HWP · HWPX</p>
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

            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {files.map((f) => (
                  <li key={f.name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                    <FileText size={13} className="shrink-0 text-slate-400" />
                    <span className="flex-1 text-sm text-white truncate">{f.name}</span>
                    <span className="text-xs text-slate-500 shrink-0">{(f.size/1024/1024).toFixed(1)}MB</span>
                    <button type="button" onClick={() => removeFile(f.name)}
                      className="shrink-0 text-slate-500 hover:text-slate-300">
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ② 연구 설명 */}
          <div>
            <p className="text-xs text-slate-300 font-medium mb-2">
              ② 연구 내용 설명
              {description && (
                <span className="ml-2 text-emerald-400 font-normal text-[11px]">
                  ✓ 워크스페이스에서 입력한 내용이 자동으로 불러와졌습니다
                </span>
              )}
            </p>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="연구 목적, 방법, 대상자, 절차 등을 설명해주세요.&#10;예) 한양대 의생명공학과 석사과정 김철수입니다. False Memory 연구를 위해 40명 대학생을 대상으로 Stroop Task 실험을 진행합니다. 약 1시간 소요됩니다."
              rows={4}
              className="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 outline-none resize-y"
            />
          </div>

          {phase.status === 'error' && (
            <p className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle size={12} />
              {phase.message}
            </p>
          )}

          <button
            onClick={handleGenerate}
            disabled={files.length === 0 || !description.trim()}
            className="cta-primary px-4 py-2 rounded-lg text-sm text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            초안 생성 시작
          </button>
        </div>
      )}

      {/* ── 진행 중 ── */}
      {isRunning && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-blue-400">
            <Loader2 size={15} className="animate-spin" />
            {phase.status === 'extracting'
              ? '파일에서 문항 분석 중...'
              : `AI가 파일별 답변 작성 중... (${phase.completed}/${phase.total})`}
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{
                width: phase.status === 'extracting'
                  ? '30%'
                  : `${30 + (phase.completed / Math.max(phase.total, 1)) * 70}%`
              }}
            />
          </div>
          <p className="text-xs text-slate-500">
            {phase.status === 'extracting'
              ? '각 파일의 문항 구조를 개별 분석하고 있습니다...'
              : `파일별로 독립 처리 중 — 문항 누락 없이 생성됩니다`}
          </p>
        </div>
      )}

      {/* ── 완료: 결과 출력 ── */}
      {phase.status === 'done' && (
        <div className="space-y-4">
          {/* 액션 바 */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 size={13} />
                {phase.output.sections.length}개 파일 초안 생성 완료
              </p>
              {(() => {
                const missingCount = phase.output.sections.reduce((acc, s) =>
                  acc + s.items.filter((i) => i.answer.includes(MISSING)).length, 0)
                return missingCount > 0 ? (
                  <p className="text-xs text-red-400">
                    ⚠ {missingCount}개 문항에 추가 정보가 필요합니다 — 붉은 표시 항목을 직접 수정하세요
                  </p>
                ) : null
              })()}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCopy(phase.output.rawText, '__all__')}
                className="flex items-center gap-1.5 text-xs glass-button px-3 py-1.5 rounded-lg text-slate-300"
              >
                {copiedKey === '__all__' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                {copiedKey === '__all__' ? '복사됨' : '전체 복사'}
              </button>
              <button onClick={handleReset} className="text-xs text-slate-500 hover:text-slate-300 underline">
                다시 시작
              </button>
            </div>
          </div>

          {/* 파일별 섹션 */}
          {phase.output.sections.map((sec) => (
            <div key={sec.fileName} className="rounded-xl overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.1)' }}>

              {/* 파일명 헤더 */}
              <button
                type="button"
                onClick={() => setOpenSections((p) => ({ ...p, [sec.fileName]: !p[sec.fileName] }))}
                className="w-full flex items-center justify-between px-4 py-3 transition-colors text-left"
                style={{ background: 'rgba(37,99,235,0.18)' }}
              >
                <span className="text-sm font-semibold text-blue-200 truncate">
                  {sec.fileName}
                </span>
                <span className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-xs text-slate-400">{sec.items.length}개 문항</span>
                  {openSections[sec.fileName]
                    ? <ChevronUp size={14} className="text-slate-400" />
                    : <ChevronDown size={14} className="text-slate-400" />}
                </span>
              </button>

              {/* 문항·답변 목록 */}
              {openSections[sec.fileName] && (
                <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  {sec.items.map((item, idx) => {
                    const copyKey = `${sec.fileName}-${idx}`
                    return (
                      <div key={idx} className="px-4 py-4 space-y-2">
                        {/* 문항 */}
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                          문항 {idx + 1}
                        </p>
                        <p className="text-sm text-slate-200">{item.question}</p>

                        {/* 답변 */}
                        <div className="relative group mt-1">
                          <div
                            className="text-sm text-white leading-relaxed whitespace-pre-wrap rounded-lg px-3 py-3 pr-10"
                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                          >
                            {renderAnswer(item.answer)}
                          </div>
                          {item.answer && (
                            <button
                              onClick={() => handleCopy(item.answer, copyKey)}
                              className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-slate-500 hover:text-slate-200"
                              title="이 답변 복사"
                            >
                              {copiedKey === copyKey
                                ? <Check size={13} className="text-emerald-400" />
                                : <Copy size={13} />}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
