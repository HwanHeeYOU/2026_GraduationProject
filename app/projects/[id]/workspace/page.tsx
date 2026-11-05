import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import WorkspaceClient from '@/components/workspace/WorkspaceClient'
import type { IRBFormDraftResult } from '@/lib/irb/types'
import { parseStoredDraft } from '@/lib/irb/draftStore'

interface WorkspacePageProps {
  params: { id: string }
}

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    redirect('/auth/login')
  }

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: session.user.id },
    include: {
      institution: { select: { id: true, name: true, shortName: true } },
      modules: {
        include: { module: true },
        orderBy: { order: 'asc' },
      },
      rejectionNotes: { orderBy: { createdAt: 'desc' } },
    },
  })

  if (!project) {
    notFound()
  }

  const rejectionNotes = project.rejectionNotes.map((n) => ({
    id: n.id,
    projectModuleId: n.projectModuleId,
    reason: n.reason,
    resolved: n.resolved,
    createdAt: n.createdAt.toISOString(),
  }))

  const modules = project.modules.map((pm) => ({
    id: pm.id,
    moduleId: pm.moduleId,
    content: pm.content,
    order: pm.order,
    module: {
      id: pm.module.id,
      name: pm.module.name,
      description: pm.module.description,
      category: pm.module.category,
      isRequired: pm.module.isRequired,
      hasFormula: pm.module.hasFormula,
      promptHint: pm.module.promptHint,
    },
  }))

  // 문항 구조(formDraftJson)와 사용자가 입력했던 정보(userInputJson)를 복원한다.
  // 초안 생성 후에도 구조가 유지되므로 돌아와도 파일을 다시 올릴 필요가 없고, 입력값도 채워진 채로 보인다.
  // (예전 프로젝트처럼 구조가 없으면 formDraft는 undefined → 패널이 업로드 모드로 시작)
  const stored = parseStoredDraft(project)
  const formDraft: IRBFormDraftResult | undefined = stored.structure ?? undefined

  return (
    <WorkspaceClient
      projectId={project.id}
      projectName={project.name}
      institutionName={project.institution.name}
      modules={modules}
      rejectionNotes={rejectionNotes}
      sourceSummary={project.sourceSummary}
      initialFormDraft={formDraft}
      initialUserInput={formDraft ? stored.userInput : undefined}
      userName={session.user.name ?? session.user.email}
    />
  )
}
