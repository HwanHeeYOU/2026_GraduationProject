import { Suspense } from 'react'
import LoginForm from '@/components/auth/LoginForm'

export const metadata = { title: '로그인 — YourPark' }

export default function LoginPage() {
  return (
    <main className="night-campus-bg min-h-screen flex items-center justify-center px-4">
      <div className="glass-card w-full max-w-[400px] p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold gradient-text mb-1">YourPark</h1>
          <p className="text-sm text-slate-400">IRB 서류 작성 보조 플랫폼</p>
        </div>

        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}
