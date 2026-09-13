import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Params = { params: { id: string; noteId: string } }

async function assertOwnership(projectId: string, userId: string) {
  return prisma.project.findFirst({ where: { id: projectId, userId } })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '인증이 필요합니다.' }, { status: 401 })
  }

  const project = await assertOwnership(params.id, session.user.id)
  if (!project) {
    return NextResponse.json({ error: 'NotFound', message: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }

  const note = await prisma.rejectionNote.findFirst({
    where: { id: params.noteId, projectId: params.id },
  })
  if (!note) {
    return NextResponse.json({ error: 'NotFound', message: '반려 사유를 찾을 수 없습니다.' }, { status: 404 })
  }

  let body: { resolved?: boolean; reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const data: { resolved?: boolean; resolvedAt?: Date | null; reason?: string } = {}
  if (typeof body.resolved === 'boolean') {
    data.resolved = body.resolved
    data.resolvedAt = body.resolved ? new Date() : null
  }
  if (typeof body.reason === 'string' && body.reason.trim()) {
    data.reason = body.reason.trim()
  }

  const updated = await prisma.rejectionNote.update({
    where: { id: params.noteId },
    data,
  })

  // 모든 반려 사유가 해결되면 프로젝트 상태를 진행 중으로 되돌림
  if (data.resolved === true) {
    const remaining = await prisma.rejectionNote.count({
      where: { projectId: params.id, resolved: false },
    })
    if (remaining === 0) {
      await prisma.project.update({
        where: { id: params.id },
        data: { status: 'IN_PROGRESS' },
      })
    }
  }

  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '인증이 필요합니다.' }, { status: 401 })
  }

  const project = await assertOwnership(params.id, session.user.id)
  if (!project) {
    return NextResponse.json({ error: 'NotFound', message: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }

  const note = await prisma.rejectionNote.findFirst({
    where: { id: params.noteId, projectId: params.id },
  })
  if (!note) {
    return NextResponse.json({ error: 'NotFound', message: '반려 사유를 찾을 수 없습니다.' }, { status: 404 })
  }

  await prisma.rejectionNote.delete({ where: { id: params.noteId } })

  return NextResponse.json({ success: true })
}
