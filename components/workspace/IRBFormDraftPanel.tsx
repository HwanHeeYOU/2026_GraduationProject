'use client'

import { useState, useRef } from 'react'
import {
  Upload, FileText, X, Loader2, CheckCircle2, AlertCircle,
  Copy, Check, ChevronDown, ChevronUp,
} from 'lucide-react'
import type {
  IRBFormDraftOutput,
  IRBFormDraftResult,
  IRBUserAnswers,
  IRBUserInput,
} from '@/lib/irb/types'
import IRBDynamicForm from './IRBDynamicForm'

// Phase 상태 머신
type Phase =
  | { status: 'idle' }
  | { status: 'extracting' }                                        // Phase 1 진행 중
  | { status: 'form'; draft: IRBFormDraftResult }                  // Phase 2: 동적 폼 입력
  | { status: 'generating' }                                        // Phase 3 진행 중
  | { status: 'done'; output: IRBFormDraftOutput }                  // 완료
  | { status: 'error'; message: string }

const ACCEPTED = '.pdf,.docx,.txt,.hwp,.hwpx'
const MAX_MB = 10
const MISSING = '[작성 필요: 추가 정보 입력 요망]'

interface IRBFormDraftPanelProps {
  /** 프로젝트 생성 시 미리 추출된 문항 구조 (있으면 Phase 1 생략) */
  initialFormDraft?: IRBFormDraftResult
  /** true면 자체 glass-card 래퍼 없이 내용만 렌더링 (탭 안에 임베드될 때) */
  embedded?: boolean
  /** 초안 생성 완료 시 호출되는 콜백 (rawText, sectionsJson) */
  onDraftComplete?: (rawText: string, sectionsJson: string) => void
  /** 리뷰에서 돌아올 때 미완 항목 question 텍스트 배열 */
  incompleteQuestions?: string[]
  /** DB 저장용 프로젝트 ID */
  projectId?: string
  /** 이전에 입력했던 정보 — 저장된 서식을 그대로 쓸 때만 폼에 미리 채운다 */
  initialUserInput?: IRBUserInput
  /** 생성 요청 직전에 호출 — 서버가 DB 에서 읽는 모듈 카드 내용이 최신이도록 저장 */
  beforeGenerate?: () => Promise<void>
}

export default function IRBFormDraftPanel({ initialFormDraft, embedded, onDraftComplete, incompleteQuestions = [], projectId, initialUserInput, beforeGenerate }: IRBFormDraftPanelProps) {
  // fileSections가 없거나 비어있으면 저장된 서식 없음으로 처리 (방어적 코드)
  const hasStoredForm = !!initialFormDraft &&
    Array.isArray(initialFormDraft.fileSections) &&
    initialFormDraft.fileSections.length > 0 &&
    Array.isArray(initialFormDraft.questions) &&
    initialFormDraft.questions.length > 0

  // 저장된 서식이 있으면 바로 Phase 2(폼 입력)로 시작
  const [phase, setPhase] = useState<Phase>(
    hasStoredForm
      ? { status: 'form', draft: initialFormDraft! }
      : { status: 'idle' }
  )

  const [isGenerating, setIsGenerating] = useState(false)
  const [useStoredForm, setUseStoredForm] = useState(hasStoredForm)
  const [files, setFiles] = useState<File[]>([])
  // 새 파일로 문항을 다시 뽑으면 키가 달라지므로 이전 입력은 버린다
  const [prefill, setPrefill] = useState<IRBUserInput | undefined>(initialUserInput)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const inputRef = useRef<HTMLInputElement>(null)

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
    setPhase({ status: 'idle' })
  }

  // ── Phase 1: 파일 → 문항 추출 ────────────────────────────
  const handleExtract = async () => {
    if (files.length === 0) return
    setPhase({ status: 'extracting' })
    try {
      const formData = new FormData()
      files.forEach((f) => formData.append('file', f))
      const res = await fetch('/api/ai/irb-form-draft', { method: 'POST', body: formData })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setPhase({ status: 'error', message: (d as { message?: string }).message ?? '문항 추출에 실패했습니다.' })
        return
      }
      const draft = await res.json() as IRBFormDraftResult
      if (!draft.questions?.length) {
        setPhase({ status: 'error', message: '파일에서 문항을 찾지 못했습니다. 다른 파일을 시도해 보세요.' })
        return
      }
      setPrefill(undefined)
      setPhase({ status: 'form', draft })
      // 내보내기 때 양식에 답변을 채워 넣을 수 있도록 원본 HWPX 보관
      if (projectId) {
        const hwpx = files.filter((f) => /\.hwpx?$/i.test(f.name))
        if (hwpx.length > 0) {
          const fd = new FormData()
          hwpx.forEach((f) => fd.append('file', f))
          fetch(`/api/projects/${projectId}/templates`, { method: 'POST', body: fd }).catch(() => {})
        }
      }
    } catch {
      setPhase({ status: 'error', message: '서버 오류가 발생했습니다. 다시 시도해 주세요.' })
    }
  }

  // ── Phase 3: 사용자 입력 → 지능형 매핑 초안 생성 ────────
  const handleGenerate = async (userAnswers: IRBUserAnswers, naturalLanguageInput: string) => {
    const draft = phase.status === 'form' ? phase.draft : null
    if (!draft) return

    // 기존 sessionStorage 초안에서 이미 채워진 답변을 병합
    // (미완 항목만 재생성할 때 나머지는 기존 결과 유지)
    const mergedAnswers: IRBUserAnswers = {}
    if (incompleteQuestions.length > 0) {
      try {
        const SESSION_KEY_DRAFT = 'irb_form_draft_output'
        const prevRaw = sessionStorage.getItem(SESSION_KEY_DRAFT)
        if (prevRaw) {
          const prevOutput = JSON.parse(prevRaw) as IRBFormDraftOutput
          // 파일 섹션의 answerKey ↔ question 역매핑
          const questionToKey = new Map<string, string>()
          draft.fileSections.forEach((sec) => {
            sec.items.forEach((item) => {
              questionToKey.set(item.question.trim(), item.answerKey)
            })
          })
          // 이전 출력에서 채워진 항목만 병합
          prevOutput.sections.forEach((sec) => {
            sec.items.forEach((item) => {
              const key = questionToKey.get(item.question.trim())
              if (key && item.answer && !item.answer.includes('[작성 필요')) {
                // 이미 userAnswers에 새 입력이 있으면 그걸 우선
                if (!userAnswers[key]?.trim()) {
                  mergedAnswers[key] = item.answer
                }
              }
            })
          })
        }
      } catch {
        // 병합 실패 시 그냥 진행
      }
    }
    // 새 입력이 병합된 기존 답변을 덮어씀
    const finalAnswers: IRBUserAnswers = { ...mergedAnswers, ...userAnswers }

    setIsGenerating(true)
    setPhase({ status: 'generating' })
    try {
      // 저장 전인 모듈 카드 입력이 있어도 서버가 최신 내용을 읽도록 먼저 저장
      if (beforeGenerate) await beforeGenerate().catch(() => {})
      const res = await fetch('/api/ai/irb-form-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          fileSections: draft.fileSections,
          mergedQuestions: draft.questions,
          userAnswers: finalAnswers,
          naturalLanguageInput,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setPhase({ status: 'error', message: (d as { message?: string }).message ?? '초안 생성에 실패했습니다.' })
        return
      }
      const output = await res.json() as IRBFormDraftOutput
      setPhase({ status: 'done', output })
      // 모든 섹션 펼치기
      const allOpen: Record<string, boolean> = {}
      output.sections.forEach((s) => { allOpen[s.fileName] = true })
      setOpenSections(allOpen)
      // 완료 콜백 — 제공된 경우 자동 라우팅 등에 활용
      if (onDraftComplete) {
        onDraftComplete(output.rawText, JSON.stringify(output))
      }
    } catch {
      setPhase({ status: 'error', message: '서버 오류가 발생했습니다. 다시 시도해 주세요.' })
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const handleReset = () => {
    setFiles([])
    setOpenSections({})
    setPhase(hasStoredForm && useStoredForm
      ? { status: 'form', draft: initialFormDraft! }
      : { status: 'idle' }
    )
  }

  // [작성 필요] 를 빨간색으로 강조
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
    <div className={embedded ? 'space-y-4' : 'glass-card p-5 mb-6 space-y-4'}>
      {/* 헤더 — embedded일 때 숨김 (탭 헤더가 역할 대신) */}
      {!embedded && (
        <div>
          <h2 className="text-sm font-semibold text-white">IRB 서류 자동 초안 생성</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            업로드한 IRB 양식 파일에서 필요 항목을 추출하고, 입력한 정보를 각 문서에 자동 배분합니다.
          </p>
        </div>
      )}

      {/* ══ Phase 0: 파일 업로드 (저장된 서식 없을 때) ══ */}
      {(phase.status === 'idle' || phase.status === 'error') && !useStoredForm && (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-300 font-medium mb-2">① IRB 원본 서식 파일 업로드</p>
            <div
              className="border border-dashed border-white/20 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400/50 hover:bg-white/[0.03] transition-colors"
              onClick={() => inputRef.current?.click()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
              onDragOver={(e) => e.preventDefault()}
            >
              <Upload size={16} className="mx-auto mb-1 text-slate-500" />
              <p className="text-sm text-slate-300">파일 드래그 또는 클릭</p>
              <p className="text-xs text-slate-500 mt-0.5">PDF · DOCX · TXT · HWP · HWPX · 여러 파일 가능</p>
              <input
                ref={inputRef} type="file" accept={ACCEPTED} multiple className="hidden"
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
                    <span className="text-xs text-slate-500 shrink-0">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
                    <button type="button" onClick={() => removeFile(f.name)}
                      className="shrink-0 text-slate-500 hover:text-slate-300">
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {phase.status === 'error' && (
            <p className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle size={12} />
              {phase.message}
            </p>
          )}

          {hasStoredForm && (
            <button type="button" onClick={() => setUseStoredForm(true)}
              className="text-xs text-slate-400 hover:text-slate-200 underline">
              처음 업로드한 서식 다시 사용하기
            </button>
          )}

          <button
            onClick={handleExtract}
            disabled={files.length === 0}
            className="w-full cta-primary py-2.5 rounded-xl text-sm text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            문항 추출 시작
          </button>
        </div>
      )}

      {/* ══ Phase 1 진행 중 ══ */}
      {phase.status === 'extracting' && (
        <ProgressView
          label="파일에서 문항 분석 중..."
          sub="각 파일의 필요 항목을 추출하고 중복을 통합하고 있습니다..."
          progress={40}
        />
      )}

      {/* ══ Phase 2: 저장된 서식으로 바로 시작 (폼 진입 전) ══ */}
      {phase.status === 'idle' && useStoredForm && initialFormDraft && (
        <div className="space-y-4">
          <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
            <p className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <CheckCircle2 size={13} />
              프로젝트 생성 시 업로드한 원본 서식을 기억해 두었습니다
            </p>
            <ul className="space-y-1">
              {initialFormDraft.fileSections.map((s) => (
                <li key={s.fileName} className="flex items-center gap-2 text-xs text-slate-300">
                  <FileText size={12} className="shrink-0 text-slate-500" />
                  <span className="flex-1 truncate">{s.fileName}</span>
                  <span className="text-slate-500 shrink-0">{s.items.length}개 문항</span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setUseStoredForm(false)}
              className="text-xs text-slate-400 hover:text-slate-200 underline">
              다른 파일로 다시 하기
            </button>
          </div>
          <button
            onClick={() => setPhase({ status: 'form', draft: initialFormDraft })}
            className="w-full cta-primary py-2.5 rounded-xl text-sm text-white font-medium"
          >
            정보 입력하기 →
          </button>
        </div>
      )}

      {/* ══ Phase 2: 동적 입력 폼 ══ */}
      {phase.status === 'form' && (
        <div className="space-y-4">
          {/* 파일 서식 정보 표시 */}
          {!useStoredForm && files.length > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
              <span className="text-xs text-emerald-300 font-medium">
                {phase.draft.questions.length}개 통합 문항 추출 완료
              </span>
              <span className="text-xs text-slate-500 ml-auto">
                {phase.draft.fileSections.length}개 파일 → 1회 입력으로 자동 배분
              </span>
            </div>
          )}

          <IRBDynamicForm
            questions={phase.draft.questions}
            fileSections={phase.draft.fileSections}
            onSubmit={handleGenerate}
            isSubmitting={isGenerating}
            incompleteQuestions={incompleteQuestions}
            initialAnswers={prefill?.userAnswers}
            initialNaturalInput={prefill?.naturalLanguageInput}
          />

          <button type="button" onClick={handleReset}
            className="text-xs text-slate-500 hover:text-slate-300 underline">
            처음부터 다시
          </button>
        </div>
      )}

      {/* ══ Phase 3 진행 중 ══ */}
      {phase.status === 'generating' && (
        <ProgressView
          label="AI가 파일별 답변을 작성 중..."
          sub="입력하신 정보를 각 파일의 문항에 맥락에 맞게 배분하고 있습니다..."
          progress={65}
        />
      )}

      {/* ══ 완료: 결과 출력 ══ */}
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
                const missingCount = phase.output.sections.reduce(
                  (acc, s) => acc + s.items.filter((i) => i.answer.includes(MISSING)).length,
                  0
                )
                return missingCount > 0 ? (
                  <p className="text-xs text-amber-400">
                    ⚠ {missingCount}개 문항에 추가 정보가 필요합니다
                  </p>
                ) : (
                  <p className="text-xs text-emerald-400">✓ 모든 문항에 답변이 생성되었습니다</p>
                )
              })()}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCopy(phase.output.rawText, '__all__')}
                className="flex items-center gap-1.5 text-xs glass-button px-3 py-1.5 rounded-lg text-slate-300"
              >
                {copiedKey === '__all__'
                  ? <><Check size={12} className="text-emerald-400" /> 복사됨</>
                  : <><Copy size={12} /> 전체 복사</>}
              </button>
              <button onClick={handleReset}
                className="text-xs text-slate-500 hover:text-slate-300 underline">
                다시 시작
              </button>
            </div>
          </div>

          {/* 파일별 섹션 아코디언 */}
          {phase.output.sections.map((sec) => (
            <div key={sec.fileName} className="rounded-xl overflow-hidden border border-white/10">
              <button
                type="button"
                onClick={() => setOpenSections((p) => ({ ...p, [sec.fileName]: !p[sec.fileName] }))}
                className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors"
                style={{ background: 'rgba(37,99,235,0.18)' }}
              >
                <span className="text-sm font-semibold text-blue-200 truncate">{sec.fileName}</span>
                <span className="flex items-center gap-2 shrink-0 ml-2">
                  {/* 누락 항목 수 뱃지 */}
                  {(() => {
                    const mc = sec.items.filter((i) => i.answer.includes(MISSING)).length
                    return mc > 0 ? (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                        {mc}개 미완
                      </span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                        완료
                      </span>
                    )
                  })()}
                  <span className="text-xs text-slate-400">{sec.items.length}개</span>
                  {openSections[sec.fileName]
                    ? <ChevronUp size={14} className="text-slate-400" />
                    : <ChevronDown size={14} className="text-slate-400" />}
                </span>
              </button>

              {openSections[sec.fileName] && (
                <div className="divide-y divide-white/[0.06]">
                  {sec.items.map((item, idx) => {
                    const copyKey = `${sec.fileName}-${idx}`
                    const isMissing = item.answer.includes(MISSING)
                    return (
                      <div key={idx} className="px-4 py-4 space-y-2">
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                          문항 {idx + 1}
                        </p>
                        <p className="text-sm text-slate-200">{item.question}</p>
                        <div className={`relative group mt-1 rounded-lg px-3 py-3 pr-10 ${
                          isMissing ? 'border border-amber-500/30 bg-amber-500/5' : 'border border-white/8 bg-white/[0.04]'
                        }`}>
                          <div className="text-sm text-white leading-relaxed whitespace-pre-wrap">
                            {renderAnswer(item.answer)}
                          </div>
                          {!isMissing && (
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

// ── 공통 진행 표시 ────────────────────────────────────────────
function ProgressView({ label, sub, progress }: { label: string; sub: string; progress: number }) {
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-2 text-sm text-blue-400">
        <Loader2 size={15} className="animate-spin" />
        {label}
      </div>
      <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-700"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  )
}
