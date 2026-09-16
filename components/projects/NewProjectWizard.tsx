'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, ArrowLeft, CheckCircle } from 'lucide-react'
import InstitutionSelector from './InstitutionSelector'
import ModuleSelector from './ModuleSelector'
import IRBFileUploader from './IRBFileUploader'
import type { ModuleRecommendation, NewModuleSuggestion, IRBFormDraftResult } from '@/lib/irb/types'

interface Institution {
  id: string
  name: string
  shortName?: string | null
}

type AnalysisState =
  | { status: 'idle' }
  | { status: 'analyzing' }
  | { status: 'done'; recommendations: ModuleRecommendation[]; newSuggestions: NewModuleSuggestion[]; summary: string }
  | { status: 'error'; message: string }

type FormDraftState =
  | { status: 'idle' }
  | { status: 'extracting' }
  | { status: 'done'; result: IRBFormDraftResult }
  | { status: 'error' }

type Step = 1 | 2

export default function NewProjectWizard() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [projectName, setProjectName] = useState('')
  const [selectedInstitution, setSelectedInstitution] = useState<Institution | null>(null)
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [analysisState, setAnalysisState] = useState<AnalysisState>({ status: 'idle' })
  const [formDraftState, setFormDraftState] = useState<FormDraftState>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  const formDraftAbortRef = useRef<AbortController | null>(null)

  const canProceedStep1 =
    projectName.trim().length > 0 &&
    selectedInstitution !== null &&
    analysisState.status !== 'analyzing'

  const recommendations =
    analysisState.status === 'done' ? analysisState.recommendations : undefined
  const newSuggestions =
    analysisState.status === 'done' ? analysisState.newSuggestions : undefined

  // Auto-trigger analysis whenever files + institution are both set
  useEffect(() => {
    if (uploadedFiles.length === 0 || !selectedInstitution) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const run = async () => {
      setAnalysisState({ status: 'analyzing' })

      const formData = new FormData()
      uploadedFiles.forEach((f) => formData.append('file', f))
      formData.append('institutionId', selectedInstitution.id)

      try {
        const res = await fetch('/api/ai/analyze-irb-file', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setAnalysisState({
            status: 'error',
            message: (data as { message?: string }).message ?? '파일 분석에 실패했습니다.',
          })
          return
        }

        const data: {
          recommendations: ModuleRecommendation[]
          newSuggestions?: NewModuleSuggestion[]
          summary?: string
        } = await res.json()

        const aiRequiredIds = data.recommendations
          .filter((r) => r.status === 'required')
          .map((r) => r.moduleId)
        setSelectedModuleIds((prev) => Array.from(new Set([...prev, ...aiRequiredIds])))

        setAnalysisState({
          status: 'done',
          recommendations: data.recommendations,
          newSuggestions: data.newSuggestions ?? [],
          summary: data.summary ?? '',
        })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setAnalysisState({ status: 'error', message: '파일 분석에 실패했습니다.' })
      }
    }

    run()

    return () => { controller.abort() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedFiles, selectedInstitution?.id])

  // 업로드한 원본 서식 파일의 문항을 미리 추출해 프로젝트에 "기억"시켜 둠
  // → 검토 단계에서 파일을 다시 올릴 필요 없이 바로 문항별 초안을 생성할 수 있게 함
  useEffect(() => {
    if (uploadedFiles.length === 0) {
      setFormDraftState({ status: 'idle' })
      return
    }

    formDraftAbortRef.current?.abort()
    const controller = new AbortController()
    formDraftAbortRef.current = controller

    const run = async () => {
      setFormDraftState({ status: 'extracting' })

      const formData = new FormData()
      uploadedFiles.forEach((f) => formData.append('file', f))

      try {
        const res = await fetch('/api/ai/irb-form-draft', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })
        if (!res.ok) {
          setFormDraftState({ status: 'error' })
          return
        }
        const data: IRBFormDraftResult = await res.json()
        setFormDraftState({ status: 'done', result: data })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setFormDraftState({ status: 'error' })
      }
    }

    run()

    return () => { controller.abort() }
  }, [uploadedFiles])

  // 파일 목록 변경 핸들러
  const handleFilesChange = (files: File[]) => {
    abortRef.current?.abort()
    formDraftAbortRef.current?.abort()
    setUploadedFiles(files)
    if (files.length === 0) {
      setAnalysisState({ status: 'idle' })
      setFormDraftState({ status: 'idle' })
    }
  }

  const handleNext = () => {
    if (canProceedStep1) setStep(2)
  }

  const handleBack = () => {
    setStep(1)
    setSubmitError(null)
  }

  const handleCreate = async () => {
    if (!selectedInstitution || selectedModuleIds.length === 0) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const sourceSummary = analysisState.status === 'done' ? analysisState.summary : ''
      const formDraft = formDraftState.status === 'done' ? formDraftState.result : undefined
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName.trim(),
          institutionId: selectedInstitution.id,
          formDraft,
          selectedModuleIds,
          sourceSummary: sourceSummary || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error((data as { message?: string }).message ?? '프로젝트 생성에 실패했습니다.')
      }
      const project = await res.json()
      window.location.href = `/projects/${(project as { id: string }).id}/workspace`
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : '프로젝트 생성에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto w-full">
      {/* 단계 표시 */}
      <div className="flex items-center gap-3 mb-8">
        <StepIndicator number={1} label="학교 선택" active={step === 1} done={step > 1} />
        <div className="flex-1 h-px bg-white/10" />
        <StepIndicator number={2} label="모듈 선택" active={step === 2} done={false} />
      </div>

      <div className="glass-card p-6 md:p-8">
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-white mb-1">1단계: 학교 선택</h2>
              <p className="text-sm text-slate-300">프로젝트명을 입력하고 소속 학교를 선택하세요.</p>
            </div>

            <div>
              <label className="block text-sm text-slate-200 font-medium mb-1.5">프로젝트명</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="예: 2024년 임상 연구 IRB 신청"
                className="glass-input w-full px-4 py-3 rounded-xl text-sm text-white placeholder-slate-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm text-slate-200 font-medium mb-1.5">소속 학교 / 기관</label>
              <InstitutionSelector
                selected={selectedInstitution}
                onSelect={setSelectedInstitution}
              />
            </div>

            <IRBFileUploader
              files={uploadedFiles}
              analysisStatus={analysisState.status}
              analysisError={analysisState.status === 'error' ? analysisState.message : undefined}
              onFilesChange={handleFilesChange}
            />

            <div className="flex justify-end pt-2">
              <button
                onClick={handleNext}
                disabled={!canProceedStep1}
                className="cta-primary flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {analysisState.status === 'analyzing' ? '분석 중...' : '다음'}
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {step === 2 && selectedInstitution && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-white mb-1">2단계: 모듈 선택</h2>
              <p className="text-sm text-slate-300">
                <span className="text-blue-300 font-medium">{selectedInstitution.name}</span>의 IRB 항목을 선택하세요.
                필수 항목은 기본 선택되어 있습니다.
              </p>
            </div>

            <ModuleSelector
              institutionId={selectedInstitution.id}
              selectedIds={selectedModuleIds}
              onChange={setSelectedModuleIds}
              recommendations={recommendations}
              newSuggestions={newSuggestions}
            />

            {submitError && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {submitError}
              </p>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handleBack}
                className="glass-button flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-slate-300"
              >
                <ArrowLeft size={16} />
                이전
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting || selectedModuleIds.length === 0 || formDraftState.status === 'extracting'}
                className="cta-primary flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>생성 중...</>
                ) : formDraftState.status === 'extracting' ? (
                  <>업로드한 서식 분석 중...</>
                ) : (
                  <>
                    <CheckCircle size={16} />
                    프로젝트 생성
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StepIndicator({
  number,
  label,
  active,
  done,
}: {
  number: number
  label: string
  active: boolean
  done: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-colors ${
          done
            ? 'bg-blue-500 border-blue-500 text-white'
            : active
            ? 'border-blue-400 text-blue-400 bg-blue-500/10'
            : 'border-white/20 text-slate-500'
        }`}
      >
        {done ? <CheckCircle size={14} /> : number}
      </div>
      <span
        className={`text-sm font-medium ${
          active ? 'text-white' : done ? 'text-blue-400' : 'text-slate-500'
        }`}
      >
        {label}
      </span>
    </div>
  )
}
