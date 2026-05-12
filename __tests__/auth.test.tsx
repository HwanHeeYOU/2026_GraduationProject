// Feature: yourpark-irb-saas
// Unit test: Auth form validation

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import LoginForm from '@/components/auth/LoginForm'
import RegisterForm from '@/components/auth/RegisterForm'

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))

describe('LoginForm', () => {
  it('이메일 입력 필드가 required 속성을 가짐', () => {
    render(<LoginForm />)
    const emailInput = screen.getByLabelText(/이메일/i)
    expect(emailInput).toBeRequired()
  })

  it('비밀번호 입력 필드가 required 속성을 가짐', () => {
    render(<LoginForm />)
    const passwordInput = screen.getByLabelText(/비밀번호/i)
    expect(passwordInput).toBeRequired()
  })
})

describe('RegisterForm', () => {
  it('이메일 입력 필드가 email 타입임', () => {
    render(<RegisterForm />)
    const emailInput = screen.getByLabelText(/이메일/i)
    expect(emailInput).toHaveAttribute('type', 'email')
  })

  it('이메일 입력 필드가 required 속성을 가짐', () => {
    render(<RegisterForm />)
    const emailInput = screen.getByLabelText(/이메일/i)
    expect(emailInput).toBeRequired()
  })
})
