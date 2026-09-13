'use client'

import { useRouter } from 'next/navigation'
import { useState, useRef } from 'react'
import { Calendar, Building2, Pencil } from 'lucide-react'
import DeleteProjectDialog from './DeleteProjectDialog'

type ProjectStatus = 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED'

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
  onRename: (id: string, newName: string) => Promise<void>
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
  REJECTED: {
    label: '반려됨',
    className: 'bg-red-500/20 border-red-500/40 text-red-400',
  },
}

export default function ProjectCard({ project, onDelete, onRename }: ProjectCardProps) {
  const router = useRouter()
  const status = statusConfig[project.status]
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(project.name)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditName(project.name)
    setIsEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commitEdit = async () => {
    const trimmed = editName.trim()
    setIsEditing(false)
    if (!trimmed || trimmed === project.name) {
      setEditName(project.name)
      return
    }
    await onRename(project.id, trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') {
      setEditName(project.name)
      setIsEditing(false)
    }
  }

  return (
    <div
      onClick={() => !isEditing && router.push(`/projects/${project.id}/workspace`)}
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
      {isEditing ? (
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="w-full bg-slate-800 border border-blue-500 rounded px-2 py-1 text-white font-semibold text-base mb-3 outline-none focus:ring-1 focus:ring-blue-500"
          maxLength={100}
        />
      ) : (
        <div className="flex items-start gap-1.5 mb-3 pr-8">
          <h3 className="text-white font-semibold text-base line-clamp-2 leading-snug flex-1">
            {project.name}
          </h3>
          <button
            onClick={startEditing}
            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5 text-slate-400 hover:text-white"
            title="이름 수정"
          >
            <Pencil size={13} />
          </button>
        </div>
      )}

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
