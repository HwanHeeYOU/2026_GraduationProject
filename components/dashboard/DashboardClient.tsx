'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import ProjectCard from './ProjectCard'

type ProjectStatus = 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED'

interface Project {
  id: string
  name: string
  status: ProjectStatus
  updatedAt: string
  institution: {
    id: string
    name: string
    shortName?: string | null
  }
}

interface DashboardClientProps {
  initialProjects: Project[]
}

export default function DashboardClient({ initialProjects }: DashboardClientProps) {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>(initialProjects)

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setProjects((prev) => prev.filter((p) => p.id !== id))
    }
  }

  return (
    <div>
      {/* 헤더 영역 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">내 프로젝트</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {projects.length}개의 프로젝트
          </p>
        </div>
        <button
          onClick={() => router.push('/projects/new')}
          className="cta-primary flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-white font-medium"
        >
          <Plus size={16} />
          새 프로젝트 만들기
        </button>
      </div>

      {/* 프로젝트 그리드 */}
      {projects.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-slate-400 mb-4">아직 프로젝트가 없습니다.</p>
          <button
            onClick={() => router.push('/projects/new')}
            className="cta-primary px-5 py-2.5 rounded-lg text-sm text-white font-medium"
          >
            첫 프로젝트 만들기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
