import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import ReviewClient from '@/components/review/ReviewClient'
import { parseStoredDraft } from '@/lib/irb/draftStore'

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
    select: {
      id: true,
      name: true,
      formDraftJson: true,
      draftOutputJson: true,
      userInputJson: true,
      institution: { select: { name: true } },
    },
  })

  if (!project) {
    notFound()
  }

  // DB에 저장된 최신 초안/문항 구조 로드 (예전 프로젝트는 legacy 형태도 읽음)
  const stored = parseStoredDraft(project)

  return (
    <ReviewClient
      projectId={project.id}
      projectName={project.name}
      institutionName={project.institution.name}
      savedOutput={stored.output}
      structure={stored.effectiveStructure}
      userName={session.user.name ?? session.user.email}
    />
  )
}
