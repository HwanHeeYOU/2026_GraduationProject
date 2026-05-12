'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function RegisterForm() {
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

      // 가입 성공 → 로그인 페이지로 이동
      router.push('/auth/login')
    } catch {
      setError('서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm text-slate-300">
          이름 (선택)
        </label>
        <input
          id="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="홍길동"
          className="glass-input rounded-lg px-4 py-2.5 text-sm placeholder:text-slate-500 focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm text-slate-300">
          이메일
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="glass-input rounded-lg px-4 py-2.5 text-sm placeholder:text-slate-500 focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm text-slate-300">
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="8자 이상 입력"
          className="glass-input rounded-lg px-4 py-2.5 text-sm placeholder:text-slate-500 focus:outline-none"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="cta-primary rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {loading ? '가입 중...' : '회원가입'}
      </button>

      <p className="text-center text-sm text-slate-400">
        이미 계정이 있으신가요?{' '}
        <Link href="/auth/login" className="text-blue-400 hover:underline">
          로그인
        </Link>
      </p>
    </form>
  )
}
