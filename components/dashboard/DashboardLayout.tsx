import DashboardHeader from './DashboardHeader'

interface DashboardLayoutProps {
  userName?: string | null
  children: React.ReactNode
}

export default function DashboardLayout({ userName, children }: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col">
      <DashboardHeader userName={userName} />

      <div className="flex flex-1 overflow-hidden">
        {/* 사이드바 */}
        <aside className="hidden md:flex w-56 shrink-0 flex-col gap-2 p-4 glass-card m-3 rounded-xl">
          <nav className="flex flex-col gap-1">
            <a
              href="/dashboard"
              className="glass-nav-item px-3 py-2 text-sm text-slate-200 font-medium"
            >
              대시보드
            </a>
            <a
              href="/projects/new"
              className="glass-nav-item px-3 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              새 프로젝트
            </a>
          </nav>
        </aside>

        {/* 메인 영역 */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
