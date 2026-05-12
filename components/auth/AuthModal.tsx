'use client'

import { useState, Suspense, useEffect } from 'react'
import { X } from 'lucide-react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

type Mode = 'login' | 'register'

interface AuthModalProps {
  initialMode?: Mode
  onClose: () => void
}

function LoginForm({ onClose, onSwitchToRegister }: { onClose: () => void; onSwitchToRegister: () => void }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)
    if (result?.error) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.')
      return
    }
    onClose()
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-email" className="text-xs text-slate-300 font-medium">이메일</label>
        <input
          id="login-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="glass-input rounded-xl px-4 py-3 text-sm placeholder:text-slate-500 focus:outline-none w-full"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-password" className="text-xs text-slate-300 font-medium">비밀번호</label>
        <input
          id="login-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="glass-input rounded-xl px-4 py-3 text-sm placeholder:text-slate-500 focus:outline-none w-full"
        />
      </div>
      {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="cta-primary rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 mt-1"
      >
        {loading ? '로그인 중...' : '로그인'}
      </button>
      <p className="text-center text-xs text-slate-400 pt-1">
        계정이 없으신가요?{' '}
        <button type="button" onClick={onSwitchToRegister} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors">
          회원가입
        </button>
      </p>
    </form>
  )
}

function RegisterForm({ onClose, onSwitchToLogin }: { onClose: () => void; onSwitchToLogin: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? '회원가입에 실패했습니다.')
        setLoading(false)
        return
      }
      await signIn('credentials', { email, password, redirect: false })
      onClose()
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('서버 오류가 발생했습니다.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reg-name" className="text-xs text-slate-300 font-medium">이름 (선택)</label>
        <input
          id="reg-name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="홍길동"
          className="glass-input rounded-xl px-4 py-3 text-sm placeholder:text-slate-500 focus:outline-none w-full"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reg-email" className="text-xs text-slate-300 font-medium">이메일</label>
        <input
          id="reg-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="glass-input rounded-xl px-4 py-3 text-sm placeholder:text-slate-500 focus:outline-none w-full"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reg-password" className="text-xs text-slate-300 font-medium">비밀번호</label>
        <input
          id="reg-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="8자 이상 입력"
          className="glass-input rounded-xl px-4 py-3 text-sm placeholder:text-slate-500 focus:outline-none w-full"
        />
      </div>
      {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="cta-primary rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 mt-1"
      >
        {loading ? '가입 중...' : '회원가입'}
      </button>
      <p className="text-center text-xs text-slate-400 pt-1">
        이미 계정이 있으신가요?{' '}
        <button type="button" onClick={onSwitchToLogin} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors">
          로그인
        </button>
      </p>
    </form>
  )
}

export default function AuthModal({ initialMode = 'login', onClose }: AuthModalProps) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [visible, setVisible] = useState(false)

  // 마운트 후 애니메이션 트리거
  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(t)
  }, [])

  function handleClose() {
    setVisible(false)
    setTimeout(onClose, 300)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={handleClose}>
      {/* Dim backdrop */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          background: 'rgba(0,0,0,0.35)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          opacity: visible ? 1 : 0,
        }}
      />

      {/* Sidebar panel */}
      <div
        className="relative h-full w-full max-w-sm flex flex-col overflow-y-auto"
        style={{
          background: 'rgba(15, 20, 45, 0.45)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          borderLeft: '1px solid rgba(255,255,255,0.14)',
          boxShadow: '-12px 0 60px rgba(0,0,0,0.5), inset 1px 0 0 rgba(255,255,255,0.06)',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.32s cubic-bezier(0.22,1,0.36,1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-6"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div>
            <p className="text-white text-xl font-light tracking-tight">YourPark</p>
            <p className="text-slate-400 text-xs mt-0.5">
              {mode === 'login' ? '로그인하여 시작하세요' : '새 계정을 만드세요'}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-white transition-colors p-1"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="px-8 pt-6">
          <div
            className="flex rounded-xl overflow-hidden"
            style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}
          >
            <button
              onClick={() => setMode('login')}
              className="flex-1 py-2.5 text-sm font-medium transition-all duration-200"
              style={{
                background: mode === 'login' ? 'rgba(255,255,255,0.12)' : 'transparent',
                color: mode === 'login' ? 'white' : 'rgba(148,163,184,1)',
              }}
            >
              로그인
            </button>
            <button
              onClick={() => setMode('register')}
              className="flex-1 py-2.5 text-sm font-medium transition-all duration-200"
              style={{
                background: mode === 'register' ? 'rgba(255,255,255,0.12)' : 'transparent',
                color: mode === 'register' ? 'white' : 'rgba(148,163,184,1)',
              }}
            >
              회원가입
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="px-8 py-6 flex-1">
          <Suspense>
            {mode === 'login' ? (
              <LoginForm onClose={handleClose} onSwitchToRegister={() => setMode('register')} />
            ) : (
              <RegisterForm onClose={handleClose} onSwitchToLogin={() => setMode('login')} />
            )}
          </Suspense>
        </div>

        {/* Bottom */}
        <div className="px-8 pb-8 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-slate-600 text-xs text-center">
            © {new Date().getFullYear()} YourPark. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  )
}
