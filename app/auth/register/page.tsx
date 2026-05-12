import RegisterForm from '@/components/auth/RegisterForm'

export const metadata = { title: '회원가입 — YourPark' }

export default function RegisterPage() {
  return (
    <main className="night-campus-bg min-h-screen flex items-center justify-center px-4">
      <div className="glass-card w-full max-w-[400px] p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold gradient-text mb-1">YourPark</h1>
          <p className="text-sm text-slate-400">새 계정 만들기</p>
        </div>

        <RegisterForm />
      </div>
    </main>
  )
}
