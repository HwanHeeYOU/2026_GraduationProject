'use client'

import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { LogOut, FlaskConical } from 'lucide-react'
import ThemeToggle from '@/components/ui/ThemeToggle'

interface DashboardHeaderProps {
  userName?: string | null
}

export default function DashboardHeader({ userName }: DashboardHeaderProps) {
  return (
    <header className="glass-header h-14 flex items-center justify-between px-6 shrink-0">
      {/* 로고 */}
      <Link href="/dashboard" className="flex items-center gap-2">
        <FlaskConical size={20} className="text-blue-400" />
        <span className="font-bold text-white text-lg tracking-tight">YourPark</span>
      </Link>

      {/* 우측 영역 */}
      <div className="flex items-center gap-3">
        {userName && (
          <span className="text-slate-400 text-sm hidden sm:block">
            {userName}
          </span>
        )}
        <ThemeToggle />
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="glass-button flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-slate-300 hover:text-white transition-colors"
          aria-label="로그아웃"
        >
          <LogOut size={14} />
          <span className="hidden sm:inline">로그아웃</span>
        </button>
      </div>
    </header>
  )
}
