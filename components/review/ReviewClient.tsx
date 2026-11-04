'use client'

import { useState, useEffect } from 'react'
import {
  ArrowLeft, Copy, Check, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, FileText, Loader2, PenLine,
} from 'lucide-react'
import DashboardLayout from '@/components/dashboard/DashboardLayout'
import type { IRBFormDraftOutput } from '@/lib/irb/types'

const SESSION_KEY_DRAFT = 'irb_form_draft_output'
const SESSION_KEY_INCOMPLETE = 'irb_incomplete_keys'
const MISSING = '[작성 필요: 추가 정보 입력 요망]'

// 보충 입력 키: `${fileName}|||${question}`
type SupplementMap = Record<string, string>

interface ReviewClientProps {
  projectId: string
  projectName: string
  institutionName: string
  userName?: string | null
  /** 서버에서 DB로부터 로드한 최신 초안 (없으면 sessionStorage 사용) */
  savedOutput?: IRBFormDraftOutput | null
}

export default function ReviewClient({
  projectId,
  projectName,
  institutionName,
  userName,
  savedOutput,
}: ReviewClientProps) {
  const [draftOutput, setDraftOutput] = useState<IRBFormDraftOutput | null>(savedOutput ?? null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(!!savedOutput)
  // 보충 입력값: key = `${fileName}|||${question}`
  const [supplements, setSupplements] = useState<SupplementMap>({})
  const [patching, setPatching] = useState(false)
  const [patchError, setPatchError] = useState<string | null>(null)

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

  // 보충 입력이 있는 미완 항목 수
  const filledSupplements = Object.values(supplements).filter((v) => v.trim()).length

  // 미완 항목 정보 저장 후 워크스페이스로 이동
  const handleGoBackToFill = () => {
    if (!draftOutput) { window.location.href = `/projects/${projectId}/workspace`; return }
    try {
      const missingQs = new Set<string>()
      draftOutput.sections.forEach((sec) => {
        sec.items.forEach((item) => { if (item.answer.includes(MISSING)) missingQs.add(item.question.trim()) })
      })
      sessionStorage.setItem(SESSION_KEY_INCOMPLETE, JSON.stringify(Array.from(missingQs)))
    } catch { /* 무시 */ }
    window.location.href = `/projects/${projectId}/workspace`
  }

  // 보충 입력 → PATCH API → 결과 반영 후 /review 갱신
  const handlePatchSubmit = async () => {
    if (!draftOutput || filledSupplements === 0) return
    setPatchError(null)
    setPatching(true)

    // SupplementMap → API payload 변환
    const supplementList = Object.entries(supplements)
      .filter(([, v]) => v.trim())
      .map(([key, supplement]) => {
        const [fileName, ...rest] = key.split('|||')
        return { fileName, question: rest.join('|||'), supplement: supplement.trim() }
      })

    try {
      const res = await fetch('/api/ai/irb-form-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          currentOutput: draftOutput,
          supplements: supplementList,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setPatchError((d as { message?: string }).message ?? '보완 생성에 실패했습니다.')
        return
      }
      const updated = await res.json() as IRBFormDraftOutput
      // sessionStorage 갱신
      try { sessionStorage.setItem(SESSION_KEY_DRAFT, JSON.stringify(updated)) } catch { /* 무시 */ }
      // 페이지 새로고침으로 DB 최신 데이터 로드
      window.location.reload()
    } catch {
      setPatchError('서버 오류가 발생했습니다. 다시 시도해 주세요.')
    } finally {
      setPatching(false)
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
                      각 항목 아래 입력란에 정보를 입력하고 <span className="font-semibold">보완 후 최종 검토</span>를 클릭하세요.
                    </p>
                  </div>
                  <button
                    onClick={handleGoBackToFill}
                    className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 transition-colors font-medium"
                  >
                    <ArrowLeft size={12} /> 돌아가서 채우기
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
                        const isMissing = item.answer.includes(MISSING)
                        const suppKey = `${sec.fileName}|||${item.question}`
                        return (
                          <div key={idx} className="px-5 py-4 space-y-2">
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">문항 {idx + 1}</p>
                            <p className="text-sm text-slate-200 font-medium">{item.question}</p>

                            {/* 답변 박스 */}
                            <div className={`rounded-lg px-4 py-3 text-sm leading-relaxed ${
                              isMissing ? 'bg-red-500/5 border border-red-500/25' : 'bg-white/[0.04] border border-white/[0.07]'
                            }`}>
                              {renderAnswer(item.answer)}
                            </div>

                            {/* ── 미완 항목: 보충 입력란 ── */}
                            {isMissing && (
                              <div className="mt-2 space-y-1.5">
                                <label className="flex items-center gap-1.5 text-xs font-medium text-red-300">
                                  <PenLine size={11} />
                                  여기에 추가 정보를 입력하세요
                                </label>
                                <textarea
                                  value={supplements[suppKey] ?? ''}
                                  onChange={(e) => setSupplements((prev) => ({ ...prev, [suppKey]: e.target.value }))}
                                  placeholder={`"${item.question}"에 대한 정보를 입력하세요...`}
                                  rows={2}
                                  className="glass-input w-full px-3 py-2 rounded-lg text-sm text-white placeholder-slate-500 outline-none resize-y border border-red-500/20 focus:border-red-400/40"
                                />
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

            {/* 보완 후 최종 검토 버튼 (미완 항목 있고 보충 입력이 하나 이상일 때) */}
            {totalMissing > 0 && (
              <div className="glass-card p-4 space-y-3">
                {patchError && (
                  <p className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertTriangle size={12} /> {patchError}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">
                    {filledSupplements > 0 ? (
                      <span className="text-emerald-400 font-medium">{filledSupplements}개 항목</span>
                    ) : (
                      <span>위 미완 항목에 추가 정보를 입력해 주세요</span>
                    )}
                    {filledSupplements > 0 && <span>에 추가 정보가 입력되었습니다</span>}
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
