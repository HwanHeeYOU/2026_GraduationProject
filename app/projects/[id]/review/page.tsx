import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import ReviewClient from '@/components/review/ReviewClient'
import type { IRBFormDraftResult } from '@/lib/irb/types'

interface ReviewPageProps {
  params: { id: string }
}

export default async function ReviewPage({ params }: ReviewPageProps) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    redirect('/auth/login')
  }

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: session.user.id },
    include: {
      institution: { select: { id: true, name: true } },
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
    content: pm.content,
    order: pm.order,
    module: {
      name: pm.module.name,
      category: pm.module.category,
    },
  }))

  let initialFormDraft: IRBFormDraftResult | null = null
  if (project.formDraftJson) {
    try {
      initialFormDraft = JSON.parse(project.formDraftJson) as IRBFormDraftResult
    } catch {
      initialFormDraft = null
    }
  }

  return (
    <ReviewClient
      projectId={project.id}
      projectName={project.name}
      institutionName={project.institution.name}
      modules={modules}
      initialFormDraft={initialFormDraft}
      userName={session.user.name ?? session.user.email}
    />
  )
}
