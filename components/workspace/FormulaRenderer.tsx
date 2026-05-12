'use client'

interface FormulaRendererProps {
  formula: string
}

// KaTeX fallback: monospace 폰트로 수식 스타일링
export default function FormulaRenderer({ formula }: FormulaRendererProps) {
  if (!formula) return null

  return (
    <div className="mt-2 p-3 rounded-lg bg-slate-900/60 border border-white/10 overflow-x-auto">
      <code className="font-mono text-sm text-purple-300 whitespace-pre-wrap break-all">
        {formula}
      </code>
    </div>
  )
}
