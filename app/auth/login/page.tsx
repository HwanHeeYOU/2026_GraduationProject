import { Suspense } from 'react'
import LoginForm from '@/components/auth/LoginForm'
import Header from '@/components/landing/Header'

export const metadata = { title: '로그인 — YourPark' }

export default function LoginPage() {
  return (
    <main
      className="relative h-screen overflow-hidden flex flex-col"
      style={{
        backgroundImage: "url('/night-bg.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center center',
      }}
    >
      {/* 오버레이 */}
      <div className="absolute inset-0 bg-black/50 pointer-events-none" aria-hidden="true" />

      {/* 랜딩과 동일한 헤더 (메뉴 포함) */}
      <Header />

      {/* 중앙 로그인 카드 */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-4">
        <div className="glass-card w-full max-w-[400px] p-8">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold gradient-text mb-1">YourPark</h1>
            <p className="text-sm text-slate-400">IRB 서류 작성 보조 플랫폼</p>
          </div>

          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  )
}
