'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  ArrowLeft, Copy, Check, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, FileText, Loader2, PenLine, Pencil,
} from 'lucide-react'
import DashboardLayout from '@/components/dashboard/DashboardLayout'
import type { IRBFormDraftOutput, IRBFormDraftResult } from '@/lib/irb/types'
import { groupMissing, isMissing, MISSING_MARKER } from '@/lib/irb/draftStore'

const SESSION_KEY_DRAFT = 'irb_form_draft_output'
const SESSION_KEY_INCOMPLETE = 'irb_incomplete_keys'
const MISSING = MISSING_MARKER

// 보충 입력 키: answerKey (같은 정보를 요구하는 여러 문서의 문항은 입력란 1개)
type SupplementMap = Record<string, string>

interface ReviewClientProps {
  projectId: string
  projectName: string
  institutionName: string
  userName?: string | null
  /** 서버에서 DB로부터 로드한 최신 초안 (없으면 sessionStorage 사용) */
  savedOutput?: IRBFormDraftOutput | null
  /** 문항 구조(answerKey 매핑). 같은 정보를 쓰는 문항을 묶는 데 사용 */
  structure?: IRBFormDraftResult | null
}

export default function ReviewClient({
  projectId,
  projectName,
  institutionName,
  userName,
  savedOutput,
  structure,
}: ReviewClientProps) {
  const [draftOutput, setDraftOutput] = useState<IRBFormDraftOutput | null>(savedOutput ?? null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(!!savedOutput)
  // 보충 입력값: key = answerKey
  const [supplements, setSupplements] = useState<SupplementMap>({})
  const [patching, setPatching] = useState(false)
  const [patchError, setPatchError] = useState<string | null>(null)
  // 답변 직접 수정 상태
  const [editing, setEditing] = useState<{ fileName: string; question: string; text: string } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  // DB 데이터가 없으면 sessionStorage 폴백
  useEffect(() => {
    if (savedOutput) {
      // DB 데이터 사용 — 모든 섹션 펼침
      const allOpen: Record<string, boolean> = {}
      savedOutput.sections.forEach((s) => { allOpen[s.fileName] = true })
      setOpenSections(allOpen)
      setLoaded(true)
      return
    }
    try {
      const raw = sessionStorage.getItem(SESSION_KEY_DRAFT)
      if (raw) {
        const parsed = JSON.parse(raw) as IRBFormDraftOutput
        setDraftOutput(parsed)
        const allOpen: Record<string, boolean> = {}
        parsed.sections.forEach((s) => { allOpen[s.fileName] = true })
        setOpenSections(allOpen)
      }
    } catch {
      // 파싱 실패
    }
    setLoaded(true)
  }, [savedOutput])

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    } catch { /* 무시 */ }
  }

  const handleCopyAll = () => {
    if (!draftOutput) return
    handleCopy(draftOutput.rawText, '__all__')
  }

  const buildFileCopyText = (sec: IRBFormDraftOutput['sections'][0]) =>
    sec.items.map((i) => `[문항] ${i.question}\n[답변] ${i.answer}`).join('\n\n')

  const totalMissing = draftOutput?.sections.reduce(
    (acc, s) => acc + s.items.filter((i) => i.answer.includes(MISSING)).length, 0
  ) ?? 0

  // 누락 항목을 answerKey 로 묶음 — 같은 정보를 요구하는 여러 문서의 문항 = 입력란 1개
  const missingGroups = useMemo(
    () => (draftOutput && structure ? groupMissing(draftOutput, structure) : []),
    [draftOutput, structure],
  )

  // 보충 입력이 있는 그룹 수
  const filledSupplements = missingGroups.filter((g) => supplements[g.answerKey]?.trim()).length

  const syncSession = (out: IRBFormDraftOutput) => {
    try { sessionStorage.setItem(SESSION_KEY_DRAFT, JSON.stringify(out)) } catch { /* 무시 */ }
  }

  // 미완 항목 정보 저장 후 워크스페이스로 이동
  const handleGoBackToFill = () => {
    if (!draftOutput) { window.location.href = `/projects/${projectId}/workspace`; return }
    try {
      const missingQs = new Set<string>()
      draftOutput.sections.forEach((sec) => {
        sec.items.forEach((item) => { if (isMissing(item.answer)) missingQs.add(item.question.trim()) })
      })
      sessionStorage.setItem(SESSION_KEY_INCOMPLETE, JSON.stringify(Array.from(missingQs)))
      syncSession(draftOutput)
    } catch { /* 무시 */ }
    window.location.href = `/projects/${projectId}/workspace`
  }

  // 보충 입력 → PATCH: 저장된 입력과 병합 → 같은 정보를 쓰는 모든 문서의 누락 항목만 AI 재생성
  const handlePatchSubmit = async () => {
    if (!draftOutput || filledSupplements === 0) return
    setPatchError(null)
    setPatching(true)

    const supplementList = missingGroups
      .filter((g) => supplements[g.answerKey]?.trim())
      .map((g) => ({ answerKey: g.answerKey, supplement: supplements[g.answerKey].trim() }))

    try {
      const res = await fetch('/api/ai/irb-form-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, supplements: supplementList }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setPatchError((d as { message?: string }).message ?? '보완 생성에 실패했습니다.')
        return
      }
      const updated = await res.json() as IRBFormDraftOutput
      syncSession(updated)
      setDraftOutput(updated)   // 새로고침 없이 바로 반영
      setSupplements({})
    } catch {
      setPatchError('서버 오류가 발생했습니다. 다시 시도해 주세요.')
    } finally {
      setPatching(false)
    }
  }

  // 답변 직접 수정 저장 (해당 문항만 교체, 나머지는 그대로)
  const handleSaveEdit = async () => {
    if (!editing) return
    setSavingEdit(true)
    setPatchError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: editing.fileName, question: editing.question, answer: editing.text }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setPatchError((d as { message?: string }).message ?? '저장에 실패했습니다.')
        return
      }
      const updated = await res.json() as IRBFormDraftOutput
      syncSession(updated)
      setDraftOutput(updated)
      setEditing(null)
    } catch {
      setPatchError('서버 오류가 발생했습니다. 다시 시도해 주세요.')
    } finally {
      setSavingEdit(false)
    }
  }

  // [작성 필요] 텍스트 붉은색 하이라이팅
  const renderAnswer = (text: string) => {
    if (!text) return <span className="text-slate-500 italic">내용 없음</span>
    const parts = text.split(MISSING)
    if (parts.length === 1) return <span className="whitespace-pre-wrap">{text}</span>
    return (
      <>
        {parts.map((part, i) => (
          <span key={i}>
            <span className="whitespace-pre-wrap">{part}</span>
            {i < parts.length - 1 && (
              <mark className="bg-transparent text-red-500 font-bold not-italic">{MISSING}</mark>
            )}
          </span>
        ))}
      </>
    )
  }

  return (
    <DashboardLayout userName={userName}>
      <div className="py-2 max-w-4xl mx-auto">

        {/* 상단 헤더 */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <button
              onClick={handleGoBackToFill}
              className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-sm mb-2 transition-colors"
            >
              <ArrowLeft size={14} />
              {totalMissing > 0 ? '미완 항목 채우러 돌아가기' : '워크스페이스로 돌아가기'}
            </button>
            <h1 className="text-xl font-bold text-white">{projectName}</h1>
            <p className="text-sm text-slate-400 mt-0.5">{institutionName}</p>
          </div>
          {draftOutput && (
            <button onClick={handleCopyAll} className="cta-primary flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-white font-medium shrink-0">
              {copiedKey === '__all__' ? <><Check size={14} className="text-emerald-300" /> 복사됨</> : <><Copy size={14} /> 모든 파일 전체 복사</>}
            </button>
          )}
        </div>

        {/* 로드 전 스켈레톤 */}
        {!loaded && (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="glass-card p-5 animate-pulse">
                <div className="h-4 bg-white/10 rounded w-1/3 mb-3" />
                <div className="h-3 bg-white/5 rounded w-full mb-2" />
                <div className="h-3 bg-white/5 rounded w-2/3" />
              </div>
            ))}
          </div>
        )}

        {/* 데이터 없음 */}
        {loaded && !draftOutput && (
          <div className="glass-card p-10 text-center space-y-4">
            <FileText size={40} className="mx-auto text-slate-600" />
            <div>
              <p className="text-white font-semibold text-base">생성된 초안이 없습니다</p>
              <p className="text-slate-400 text-sm mt-1">워크스페이스에서 'IRB 서식 자동 초안 생성'을 먼저 실행해 주세요.</p>
            </div>
            <button
              onClick={() => { window.location.href = `/projects/${projectId}/workspace` }}
              className="inline-flex items-center gap-2 cta-primary px-5 py-2.5 rounded-xl text-sm text-white font-medium"
            >
              <ArrowLeft size={14} /> 워크스페이스로 이동
            </button>
          </div>
        )}

        {/* 초안 결과 */}
        {loaded && draftOutput && (
          <div className="space-y-4">

            {/* 상태 배너 */}
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
              totalMissing > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'
            }`}>
              {totalMissing > 0 ? (
                <>
                  <AlertTriangle size={15} className="text-amber-400 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-amber-300">
                      <span className="font-semibold">{totalMissing}개 문항</span>에 추가 정보가 필요합니다.
                      아래 <span className="font-semibold">추가 정보 입력</span>란에 한 번만 입력하면 같은 정보를 쓰는 모든 문서에 반영됩니다.
                    </p>
                  </div>
                  <button
                    onClick={handleGoBackToFill}
                    className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 transition-colors font-medium"
                  >
                    <ArrowLeft size={12} /> 워크스페이스에서 수정
                  </button>
                </>
              ) : (
                <>
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                  <p className="text-sm text-emerald-300">
                    <span className="font-semibold">모든 문항</span>에 답변이 생성되었습니다. 아래 내용을 복사하여 IRB 서식에 붙여넣으세요.
                  </p>
                </>
              )}
            </div>

            {/* ── 추가 정보 입력: 같은 정보를 요구하는 문항은 1개로 묶음 ── */}
            {missingGroups.length > 0 && (
              <div className="glass-card p-5 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
                    <PenLine size={13} className="text-red-300" /> 추가 정보 입력
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    여기에 입력한 내용은 AI에 다시 전달되어, 같은 정보를 쓰는 <span className="text-slate-200">모든 문서의 빈 항목</span>에
                    반영됩니다. 이미 작성되었거나 직접 수정한 답변은 바뀌지 않습니다.
                  </p>
                </div>

                {missingGroups.map((g) => (
                  <div key={g.answerKey} className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-100">{g.label}</label>
                    <p className="text-[11px] text-slate-500">
                      적용 문서: {Array.from(new Set(g.items.map((i) => i.fileName))).join(', ')} ({g.items.length}개 문항)
                    </p>
                    <textarea
                      value={supplements[g.answerKey] ?? ''}
                      onChange={(e) => setSupplements((prev) => ({ ...prev, [g.answerKey]: e.target.value }))}
                      placeholder={`"${g.label}"에 대한 정보를 입력하세요...`}
                      rows={2}
                      className="glass-input w-full px-3 py-2 rounded-lg text-sm text-white placeholder-slate-500 outline-none resize-y border border-red-500/20 focus:border-red-400/40"
                    />
                  </div>
                ))}

                {patchError && (
                  <p className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertTriangle size={12} /> {patchError}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">
                    {filledSupplements > 0
                      ? <><span className="text-emerald-400 font-medium">{filledSupplements}개 항목</span>에 정보가 입력되었습니다</>
                      : '위 항목에 추가 정보를 입력해 주세요'}
                  </div>
                  <button
                    onClick={handlePatchSubmit}
                    disabled={patching || filledSupplements === 0}
                    className="cta-primary flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {patching ? (
                      <><Loader2 size={14} className="animate-spin" /> 보완 생성 중...</>
                    ) : (
                      <><CheckCircle2 size={14} /> 보완 후 최종 검토</>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* 저장 오류 (직접 수정) — 추가 정보 패널이 없을 때도 표시 */}
            {missingGroups.length === 0 && patchError && (
              <p className="flex items-center gap-1.5 text-xs text-red-400">
                <AlertTriangle size={12} /> {patchError}
              </p>
            )}

            {/* 파일별 아코디언 카드 */}
            {draftOutput.sections.map((sec) => {
              const fileMissing = sec.items.filter((i) => i.answer.includes(MISSING)).length
              const isOpen = !!openSections[sec.fileName]
              const fileCopyKey = `file-${sec.fileName}`

              return (
                <div key={sec.fileName} className="rounded-2xl border border-white/10 overflow-hidden">
                  {/* 카드 헤더 */}
                  <div
                    className="flex items-center justify-between px-5 py-4 cursor-pointer select-none"
                    style={{ background: 'rgba(37,99,235,0.12)' }}
                    onClick={() => setOpenSections((p) => ({ ...p, [sec.fileName]: !isOpen }))}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText size={16} className="text-blue-400 shrink-0" />
                      <span className="text-base font-semibold text-blue-100 truncate">{sec.fileName}</span>
                      <span className="text-xs text-slate-500 shrink-0">{sec.items.length}개 문항</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      {fileMissing > 0 ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">{fileMissing}개 미완</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">완료</span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleCopy(buildFileCopyText(sec), fileCopyKey) }}
                        className="flex items-center gap-1.5 text-xs glass-button px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white transition-colors"
                      >
                        {copiedKey === fileCopyKey ? <><Check size={12} className="text-emerald-400" /> 복사됨</> : <><Copy size={12} /> 파일 복사</>}
                      </button>
                      {isOpen ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
                    </div>
                  </div>

                  {/* 카드 본문 */}
                  {isOpen && (
                    <div className="divide-y divide-white/[0.05]">
                      {sec.items.map((item, idx) => {
                        const itemMissing = isMissing(item.answer)
                        const isEditing = editing?.fileName === sec.fileName && editing.question === item.question
                        return (
                          <div key={idx} className="px-5 py-4 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">문항 {idx + 1}</p>
                              {!isEditing && (
                                <button
                                  type="button"
                                  onClick={() => setEditing({
                                    fileName: sec.fileName,
                                    question: item.question,
                                    text: itemMissing ? '' : item.answer,
                                  })}
                                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                                >
                                  <Pencil size={11} /> 직접 수정
                                </button>
                              )}
                            </div>
                            <p className="text-sm text-slate-200 font-medium">{item.question}</p>

                            {isEditing ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editing.text}
                                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                                  rows={4}
                                  autoFocus
                                  className="glass-input w-full px-3 py-2 rounded-lg text-sm text-white outline-none resize-y border border-blue-400/30 focus:border-blue-400/60"
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setEditing(null)}
                                    disabled={savingEdit}
                                    className="glass-button px-3 py-1.5 rounded-lg text-xs text-slate-300"
                                  >
                                    취소
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleSaveEdit}
                                    disabled={savingEdit || !editing.text.trim()}
                                    className="cta-primary px-3 py-1.5 rounded-lg text-xs text-white font-medium disabled:opacity-40"
                                  >
                                    {savingEdit ? '저장 중...' : '저장'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className={`rounded-lg px-4 py-3 text-sm leading-relaxed ${
                                itemMissing ? 'bg-red-500/5 border border-red-500/25' : 'bg-white/[0.04] border border-white/[0.07]'
                              }`}>
                                {renderAnswer(item.answer)}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            {/* 하단 전체 복사 */}
            <div className="flex justify-center pt-2 pb-6">
              <button
                onClick={handleCopyAll}
                className="flex items-center gap-2 glass-button px-6 py-3 rounded-xl text-sm text-slate-300 hover:text-white border border-white/10 transition-all"
              >
                {copiedKey === '__all__' ? (
                  <><Check size={15} className="text-emerald-400" /> 복사 완료!</>
                ) : (
                  <><Copy size={15} /> 모든 파일 내용 전체 복사</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
