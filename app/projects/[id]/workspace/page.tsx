import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import WorkspaceClient from '@/components/workspace/WorkspaceClient'
import type { IRBFormDraftResult } from '@/lib/irb/types'

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

  // formDraftJson이 DB에 저장되어 있으면 파싱해서 전달
  // 주의: formDraftJson에는 IRBFormDraftResult(문항 구조) 또는
  //       IRBFormDraftOutput(생성된 초안)이 저장될 수 있음
  //       → IRBFormDraftResult는 questions + fileSections를 가짐
  //       → IRBFormDraftOutput은 sections(답변 포함)를 가짐
  //       워크스페이스에는 문항 구조(IRBFormDraftResult)만 필요
  let formDraft: IRBFormDraftResult | undefined
  if (project.formDraftJson) {
    try {
      const parsed = JSON.parse(project.formDraftJson)
      // IRBFormDraftResult 형태인지 확인: questions 배열 + fileSections 배열
      if (
        Array.isArray(parsed?.questions) &&
        parsed.questions.length > 0 &&
        Array.isArray(parsed?.fileSections) &&
        parsed.fileSections.length > 0
      ) {
        formDraft = parsed as IRBFormDraftResult
      }
      // IRBFormDraftOutput(sections만 있는 형태)이면 formDraft는 undefined 유지
      // → 패널이 파일 업로드 모드로 시작
    } catch {
      // 파싱 실패 시 undefined — 패널에서 직접 파일 업로드 모드로 시작
    }
  }

  return (
    <WorkspaceClient
      projectId={project.id}
      projectName={project.name}
      institutionName={project.institution.name}
      modules={modules}
      rejectionNotes={rejectionNotes}
      sourceSummary={project.sourceSummary}
      initialFormDraft={formDraft}
      userName={session.user.name ?? session.user.email}
    />
  )
}
