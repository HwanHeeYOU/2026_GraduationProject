import DashboardHeader from './DashboardHeader'

interface DashboardLayoutProps {
  userName?: string | null
  children: React.ReactNode
}

export default function DashboardLayout({ userName, children }: DashboardLayoutProps) {
  return (
    <div
      className="relative h-screen flex flex-col overflow-hidden"
      style={{
        backgroundImage: "url('/night-bg.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* 배경 오버레이 */}
      <div className="absolute inset-0 bg-black/55 pointer-events-none" aria-hidden="true" />

      {/* 상단 헤더 — 고정 */}
      <div className="relative z-20 shrink-0">
        <DashboardHeader userName={userName} />
      </div>

      {/* 사이드바 + 메인 — 남은 높이 전체 사용 */}
      <div className="relative z-10 flex flex-1 overflow-hidden">
        {/* 사이드바 — 고정, 자체 스크롤 없음 */}
        <aside className="hidden md:flex w-56 shrink-0 flex-col gap-2 p-4 m-3 rounded-xl"
          style={{
            background: 'rgba(255,255,255,0.06)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
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

        {/* 메인 영역 — 여기만 스크롤 */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
