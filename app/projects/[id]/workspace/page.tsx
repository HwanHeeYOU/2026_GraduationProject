import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import WorkspaceClient from '@/components/workspace/WorkspaceClient'

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
    },
  })

  if (!project) {
    notFound()
  }

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

  return (
    <WorkspaceClient
      projectId={project.id}
      projectName={project.name}
      institutionName={project.institution.name}
      modules={modules}
      userName={session.user.name ?? session.user.email}
    />
  )
}
