import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseStoredDraft, applyAnswers } from '@/lib/irb/draftStore'

/**
 * PUT /api/projects/:id/draft
 * Body: { fileName, question, answer }
 * 검토 화면에서 사용자가 답변을 직접 수정한 내용을 저장한다.
 * 해당 문항 하나만 교체하고, 나머지 초안은 그대로 둔다.
 * (직접 수정한 답은 누락 표시가 아니므로 이후 "보완 생성"의 대상이 되지 않는다.)
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '인증이 필요합니다.' }, { status: 401 })
  }

  let body: { fileName?: string; question?: string; answer?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: '잘못된 요청입니다.' }, { status: 400 })
  }
  const { fileName, question, answer } = body
  if (!fileName || !question || typeof answer !== 'string') {
    return NextResponse.json({ error: 'BadRequest', message: 'fileName, question, answer가 필요합니다.' }, { status: 400 })
  }

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: session.user.id },
    select: { id: true, formDraftJson: true, draftOutputJson: true, userInputJson: true },
  })
  if (!project) {
    return NextResponse.json({ error: 'NotFound', message: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }

  const stored = parseStoredDraft(project)
  if (!stored.output) {
    return NextResponse.json({ error: 'BadRequest', message: '생성된 초안이 없습니다.' }, { status: 400 })
  }

  const next = applyAnswers(stored.output, [{ fileName, question, answer: answer.trim() }])
  await prisma.project.update({
    where: { id: project.id },
    data: { draftOutputJson: JSON.stringify(next) },
  })

  return NextResponse.json(next)
}
