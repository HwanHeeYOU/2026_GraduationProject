'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    setLoading(false)

    if (result?.error) {
      // NextAuth wraps the thrown error message in result.error
      setError('이메일 또는 비밀번호가 올바르지 않습니다.')
      return
    }

    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
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
        {loading ? '로그인 중...' : '로그인'}
      </button>

      <p className="text-center text-sm text-slate-400">
        계정이 없으신가요?{' '}
        <Link href="/auth/register" className="text-blue-400 hover:underline">
          회원가입
        </Link>
      </p>
    </form>
  )
}
