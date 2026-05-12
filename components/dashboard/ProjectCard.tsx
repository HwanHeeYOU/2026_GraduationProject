'use client'

import { useRouter } from 'next/navigation'
import { Calendar, Building2 } from 'lucide-react'
import DeleteProjectDialog from './DeleteProjectDialog'

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

interface ProjectCardProps {
  project: Project
  onDelete: (id: string) => Promise<void>
}

const statusConfig: Record<ProjectStatus, { label: string; className: string }> = {
  DRAFT: {
    label: '초안',
    className: 'bg-slate-500/20 border-slate-500/40 text-slate-400',
  },
  IN_PROGRESS: {
    label: '진행 중',
    className: 'bg-blue-500/20 border-blue-500/40 text-blue-400',
  },
  COMPLETED: {
    label: '완료',
    className: 'bg-green-500/20 border-green-500/40 text-green-400',
  },
}

export default function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const router = useRouter()
  const status = statusConfig[project.status]

  return (
    <div
      onClick={() => router.push(`/projects/${project.id}/workspace`)}
      className="glass-card p-5 cursor-pointer transition-transform duration-200 hover:scale-[1.02] group relative"
    >
      {/* 삭제 버튼 */}
      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <DeleteProjectDialog
          projectName={project.name}
          onConfirm={() => onDelete(project.id)}
        />
      </div>

      {/* 상태 배지 */}
      <div className="mb-3">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${status.className}`}>
          {status.label}
        </span>
      </div>

      {/* 프로젝트명 */}
      <h3 className="text-white font-semibold text-base mb-3 pr-8 line-clamp-2 leading-snug">
        {project.name}
      </h3>

      {/* 학교명 */}
      <div className="flex items-center gap-1.5 text-slate-400 text-sm mb-2">
        <Building2 size={13} className="shrink-0" />
        <span className="truncate">{project.institution.shortName ?? project.institution.name}</span>
      </div>

      {/* 마지막 수정 일시 */}
      <div className="flex items-center gap-1.5 text-slate-500 text-xs">
        <Calendar size={12} className="shrink-0" />
        <span>{new Date(project.updatedAt).toLocaleDateString('ko-KR')}</span>
      </div>
    </div>
  )
}
