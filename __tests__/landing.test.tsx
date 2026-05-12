// Feature: yourpark-irb-saas
// Unit test: Landing page CTA buttons

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import HeroSection from '@/components/landing/HeroSection'

// Mock next/navigation (not used in HeroSection but may be imported transitively)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn() }),
}))

describe('HeroSection', () => {
  it('renders without crashing', () => {
    render(<HeroSection />)
    expect(screen.getByText('YourPark')).toBeInTheDocument()
  })

  it('"지금 바로 시작하기" 버튼이 /auth/login 링크인지 확인', () => {
    render(<HeroSection />)
    const link = screen.getByRole('link', { name: /지금 바로 시작하기/i })
    expect(link).toHaveAttribute('href', '/auth/login')
  })

  it('"무료로 항목 진단받기" 버튼이 /auth/register 링크인지 확인', () => {
    render(<HeroSection />)
    const link = screen.getByRole('link', { name: /무료로 항목 진단받기/i })
    expect(link).toHaveAttribute('href', '/auth/register')
  })
})
