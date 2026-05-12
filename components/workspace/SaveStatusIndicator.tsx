import { Loader2, CheckCircle2, XCircle } from 'lucide-react'

interface SaveStatusIndicatorProps {
  status: 'idle' | 'saving' | 'saved' | 'error'
}

export default function SaveStatusIndicator({ status }: SaveStatusIndicatorProps) {
  if (status === 'idle') return null

  if (status === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-slate-400">
        <Loader2 size={12} className="animate-spin" />
        저장 중...
      </span>
    )
  }

  if (status === 'saved') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-400">
        <CheckCircle2 size={12} />
        저장됨
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-red-400">
      <XCircle size={12} />
      저장 실패
    </span>
  )
}
