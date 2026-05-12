// Feature: yourpark-irb-saas
// Unit test: Dashboard project card rendering

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ProjectCard from '@/components/dashboard/ProjectCard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const mockProject = {
  id: 'proj-1',
  name: '암 연구 IRB 신청',
  status: 'IN_PROGRESS' as const,
  updatedAt: '2024-01-15T10:00:00Z',
  institution: {
    id: 'inst-1',
    name: '서울대학교',
    shortName: '서울대',
  },
}

describe('ProjectCard', () => {
  it('프로젝트명을 표시한다', () => {
    render(<ProjectCard project={mockProject} onDelete={vi.fn()} />)
    expect(screen.getByText('암 연구 IRB 신청')).toBeInTheDocument()
  })

  it('학교명(shortName)을 표시한다', () => {
    render(<ProjectCard project={mockProject} onDelete={vi.fn()} />)
    expect(screen.getByText('서울대')).toBeInTheDocument()
  })

  it('상태 배지를 표시한다', () => {
    render(<ProjectCard project={mockProject} onDelete={vi.fn()} />)
    expect(screen.getByText('진행 중')).toBeInTheDocument()
  })

  it('DRAFT 상태 배지를 표시한다', () => {
    const draftProject = { ...mockProject, status: 'DRAFT' as const }
    render(<ProjectCard project={draftProject} onDelete={vi.fn()} />)
    expect(screen.getByText('초안')).toBeInTheDocument()
  })
})
