'use client'

/**
 * Phase 2: 동적 입력 폼
 * - IRBFormDraftResult.questions를 받아 개별 입력 폼을 렌더링
 * - 탭 전환: 개별 입력 폼 ↔ 자연어(통합) 입력
 * - 수집된 데이터를 onSubmit으로 부모에게 반환
 */

import { useState, useCallback } from 'react'
import { ChevronDown, ChevronUp, Keyboard, AlignLeft, Info, List, AlertTriangle } from 'lucide-react'
import type { IRBFormQuestion, IRBUserAnswers } from '@/lib/irb/types'

interface IRBDynamicFormProps {
  questions: IRBFormQuestion[]
  fileSections: Array<{ fileName: string; items: Array<{ question: string; answerKey: string }> }>
  onSubmit: (answers: IRBUserAnswers, naturalLanguageInput: string) => void
  isSubmitting: boolean
  /** 리뷰에서 돌아올 때 미완 항목 question 텍스트 배열 */
  incompleteQuestions?: string[]
}

type InputMode = 'individual' | 'natural'

// 문항을 카테고리별로 그룹핑 (5개 이상일 때 섹션화)
function groupQuestions(questions: IRBFormQuestion[]): { group: string; items: IRBFormQuestion[] }[] {
  if (questions.length <= 5) return [{ group: '', items: questions }]

  const groups: Map<string, IRBFormQuestion[]> = new Map()
  for (const q of questions) {
    const prefix = q.label.split(/\s+/)[0] ?? '기타'
    if (!groups.has(prefix)) groups.set(prefix, [])
    groups.get(prefix)!.push(q)
  }
  if (groups.size > 6) return [{ group: '', items: questions }]
  return Array.from(groups.entries()).map(([g, items]) => ({ group: g, items }))
}

export default function IRBDynamicForm({
  questions,
  fileSections,
  onSubmit,
  isSubmitting,
  incompleteQuestions = [],
}: IRBDynamicFormProps) {
  const [mode, setMode] = useState<InputMode>('individual')
  const [answers, setAnswers] = useState<IRBUserAnswers>({})
  const [naturalInput, setNaturalInput] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [showQuestionPanel, setShowQuestionPanel] = useState(false)

  const handleAnswerChange = useCallback((key: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }, [])

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      next.has(group) ? next.delete(group) : next.add(group)
      return next
    })
  }

  const handleSubmit = () => {
    onSubmit(answers, naturalInput)
  }

  const filledCount = Object.values(answers).filter((v) => v.trim()).length
  const totalCount = questions.length
  const canSubmit =
    !isSubmitting &&
    (mode === 'natural' ? naturalInput.trim().length > 0 : filledCount > 0 || naturalInput.trim().length > 0)

  const grouped = groupQuestions(questions)

  // 미완 항목 — question 텍스트로 찾아 IRBFormQuestion 매핑
  const incompleteSet = new Set(incompleteQuestions.map((q) => q.trim()))
  const incompleteItems = questions.filter((q) =>
    incompleteSet.has(q.label.trim()) ||
    (q.originalVariants ?? []).some((v) => incompleteSet.has(v.trim()))
  )

  // 파일별 문항 수 요약
  const fileSummary = fileSections
    .map((f) => `${f.fileName} (${f.items.length}개)`)
    .join(' · ')

  const progressPercent = totalCount > 0 ? (filledCount / totalCount) * 100 : 0

  return (
    <div className="space-y-5">
      {/* 파일 요약 정보 */}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
        <Info size={13} className="shrink-0 text-blue-400 mt-0.5" />
        <div className="text-xs text-blue-300 leading-relaxed">
          <span className="font-medium">분석 완료:</span> {fileSummary}
          <br />
          중복 문항을 통합하여 <span className="font-medium text-white">{totalCount}개 질문</span>을 도출했습니다.
          아래에 답변을 입력하면 각 파일에 자동으로 배분됩니다.
        </div>
      </div>

      {/* 입력 모드 탭 */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
        <button
          type="button"
          onClick={() => setMode('individual')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
            mode === 'individual'
              ? 'bg-white/10 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Keyboard size={13} />
          개별 항목 입력
        </button>
        <button
          type="button"
          onClick={() => setMode('natural')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
            mode === 'natural'
              ? 'bg-white/10 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <AlignLeft size={13} />
          자연어로 한 번에
        </button>
      </div>

      {/* ── 개별 항목 입력 모드 ── */}
      {mode === 'individual' && (
        <div className="space-y-4">
          {/* 진행률 — sticky 고정 */}
          <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-[rgba(15,15,30,0.85)] backdrop-blur-md rounded-xl border border-white/[0.07] shadow-lg">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-400 font-medium">입력 진행률</span>
              <span className="text-white font-semibold tabular-nums">
                {filledCount} / {totalCount}
                <span className="ml-1.5 text-slate-500 font-normal">
                  ({Math.round(progressPercent)}%)
                </span>
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progressPercent}%`,
                  background: progressPercent === 100
                    ? 'linear-gradient(90deg, #10b981, #34d399)'
                    : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                }}
              />
            </div>
          </div>

          {/* ── 미완 항목 우선 섹션 (리뷰에서 돌아왔을 때) ── */}
          {incompleteItems.length > 0 && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-red-500/20 bg-red-500/10">
                <AlertTriangle size={14} className="text-red-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-300">
                    추가 정보가 필요한 항목 ({incompleteItems.length}개)
                  </p>
                  <p className="text-xs text-red-400/70 mt-0.5">
                    최종 검토에서 미완으로 표시된 항목입니다. 여기만 채우고 다시 초안 생성하세요.
                  </p>
                </div>
              </div>
              <div className="p-4 space-y-3">
                {incompleteItems.map((q) => (
                  <FormField
                    key={`incomplete-${q.key}`}
                    question={q}
                    value={answers[q.key] ?? ''}
                    onChange={(v) => handleAnswerChange(q.key, v)}
                    highlight
                  />
                ))}
              </div>
            </div>
          )}

          {/* 문항 그룹 */}
          {grouped.map(({ group, items }) => (
            <div key={group || '__root__'} className="space-y-3">
              {group && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  className="flex items-center gap-2 w-full text-left"
                >
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    {group} 관련
                  </span>
                  <div className="flex-1 h-px bg-white/10" />
                  {collapsedGroups.has(group)
                    ? <ChevronDown size={13} className="text-slate-500" />
                    : <ChevronUp size={13} className="text-slate-500" />}
                </button>
              )}

              {!collapsedGroups.has(group) && items.map((q) => (
                <FormField
                  key={q.key}
                  question={q}
                  value={answers[q.key] ?? ''}
                  onChange={(v) => handleAnswerChange(q.key, v)}
                />
              ))}
            </div>
          ))}

          {/* 자연어 보조 입력 */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              추가 연구 설명
              <span className="ml-1.5 text-slate-500 font-normal">
                (선택 — 위 항목을 채우기 어려울 때 자유롭게 서술하면 AI가 참고합니다)
              </span>
            </label>
            <textarea
              value={naturalInput}
              onChange={(e) => setNaturalInput(e.target.value)}
              placeholder="연구 목적, 방법, 대상자, 기간 등을 자유롭게 서술하세요..."
              rows={3}
              className="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 outline-none resize-y"
            />
          </div>
        </div>
      )}

      {/* ── 자연어 입력 모드 ── */}
      {mode === 'natural' && (
        <div className="space-y-3">
          <div className="px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 leading-relaxed">
            <strong>자연어 입력 방식:</strong> 아래 칸에 연구 내용을 자유롭게 서술하세요.
            AI가 내용을 분석하여 {totalCount}개 문항 각각에 맞게 자동으로 분배합니다.
            <br />
            오른쪽 항목 목록을 펼쳐 어떤 내용을 써야 할지 확인하면서 작성하세요.
          </div>

          {/* 사이드 패널 토글 버튼 + 메인 레이아웃 */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {naturalInput.length > 0
                ? `${naturalInput.length}자 입력됨`
                : '연구 내용을 상세히 작성할수록 초안 품질이 높아집니다'}
            </p>
            <button
              type="button"
              onClick={() => setShowQuestionPanel((v) => !v)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                showQuestionPanel
                  ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                  : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
              }`}
            >
              <List size={12} />
              {showQuestionPanel ? '항목 목록 닫기' : `${totalCount}개 항목 보기`}
            </button>
          </div>

          {/* 2컬럼 레이아웃: textarea | 항목 패널 */}
          <div className={`flex gap-3 items-start transition-all ${showQuestionPanel ? '' : ''}`}>
            {/* 텍스트 입력 */}
            <div className={`flex flex-col gap-2 transition-all ${showQuestionPanel ? 'flex-1 min-w-0' : 'w-full'}`}>
              <textarea
                value={naturalInput}
                onChange={(e) => setNaturalInput(e.target.value)}
                placeholder={`예시:\n한양대 의생명공학과 석사과정 김철수입니다. 연구 제목은 "거짓 기억 형성에 관한 인지 실험"이며, 기억 왜곡 메커니즘 규명을 목적으로 합니다.\n\n연구 대상: 만 18세 이상 대학생 40명 (남녀 각 20명)\n연구 방법: Stroop Task와 DRM 패러다임을 적용한 실험, 1회 방문 약 1시간 소요\n보상: 참여 완료 시 소정의 사례비 1만원 지급\n위험: 인지 피로 외 신체적 위험 없음`}
                rows={showQuestionPanel ? 16 : 10}
                className="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 outline-none resize-y leading-relaxed"
              />
            </div>

            {/* 항목 사이드 패널 */}
            {showQuestionPanel && (
              <div className="w-64 shrink-0 flex flex-col rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
                {/* 패널 헤더 */}
                <div className="sticky top-0 px-3 py-2.5 border-b border-white/10 bg-white/[0.04] backdrop-blur-sm">
                  <p className="text-xs font-semibold text-slate-200">작성해야 할 항목</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">총 {totalCount}개 — 아래 내용을 자연어로 포함하세요</p>
                </div>
                {/* 항목 리스트 — 스크롤 가능 */}
                <ul className="overflow-y-auto max-h-[420px] divide-y divide-white/[0.05]">
                  {questions.map((q, i) => (
                    <li key={q.key} className="px-3 py-2 flex items-start gap-2">
                      <span className="text-[10px] text-slate-600 shrink-0 mt-0.5 tabular-nums w-5 text-right">
                        {i + 1}.
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-slate-300 leading-snug">{q.label}</p>
                        {q.originalVariants && q.originalVariants.length > 1 && (
                          <p className="text-[10px] text-slate-600 mt-0.5 truncate">
                            = {q.originalVariants.slice(1, 3).join(', ')}
                            {q.originalVariants.length > 3 ? ' 등' : ''}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 제출 버튼 */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full cta-primary py-3 rounded-xl text-sm text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {isSubmitting ? '초안 생성 중...' : '초안 자동 생성'}
      </button>

      {mode === 'individual' && filledCount === 0 && !naturalInput.trim() && (
        <p className="text-center text-xs text-slate-500">
          한 항목이라도 입력하거나 추가 연구 설명을 작성하면 초안을 생성할 수 있습니다.
        </p>
      )}
    </div>
  )
}

// ── 개별 문항 입력 필드 ─────────────────────────────────────────
function FormField({
  question,
  value,
  onChange,
  highlight = false,
}: {
  question: IRBFormQuestion
  value: string
  onChange: (v: string) => void
  highlight?: boolean
}) {
  const isFilled = value.trim().length > 0

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${isFilled ? 'bg-emerald-400' : highlight ? 'bg-red-400' : 'bg-slate-600'}`} />
        <span className={highlight && !isFilled ? 'text-red-300' : ''}>{question.label}</span>
        {question.originalVariants && question.originalVariants.length > 1 && (
          <span className="text-slate-500 font-normal text-[10px]">
            · {question.originalVariants.slice(1, 3).join(' / ')}{question.originalVariants.length > 3 ? ' 등' : ''}
          </span>
        )}
      </label>
      {question.multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder ?? `${question.label}을(를) 입력하세요`}
          rows={3}
          className="glass-input w-full px-3 py-2 rounded-lg text-sm text-white placeholder-slate-500 outline-none resize-y"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder ?? `${question.label}을(를) 입력하세요`}
          className="glass-input w-full px-3 py-2 rounded-lg text-sm text-white placeholder-slate-500 outline-none"
        />
      )}
    </div>
  )
}
