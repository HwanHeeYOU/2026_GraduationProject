import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import ReviewClient from '@/components/review/ReviewClient'
import type { IRBFormDraftOutput } from '@/lib/irb/types'

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
      institution: { select: { name: true } },
    },
  })

  if (!project) {
    notFound()
  }

  // DB에 저장된 최신 초안 로드 (있으면 전달 → 클라이언트 sessionStorage보다 우선)
  let savedOutput: IRBFormDraftOutput | null = null
  if (project.formDraftJson) {
    try {
      const parsed = JSON.parse(project.formDraftJson)
      // IRBFormDraftOutput 형태인지 확인 (sections 배열이 있으면 output, 없으면 구버전 result)
      if (Array.isArray(parsed?.sections)) {
        savedOutput = parsed as IRBFormDraftOutput
      }
    } catch {
      savedOutput = null
    }
  }

  return (
    <ReviewClient
      projectId={project.id}
      projectName={project.name}
      institutionName={project.institution.name}
      savedOutput={savedOutput}
      userName={session.user.name ?? session.user.email}
    />
  )
}
