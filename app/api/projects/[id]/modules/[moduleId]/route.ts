import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Params = { params: { id: string; moduleId: string } }

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '인증이 필요합니다.' }, { status: 401 })
  }

  // 소유권 확인
  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: session.user.id },
  })

  if (!project) {
    return NextResponse.json({ error: 'NotFound', message: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }

  let body: { content?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  if (typeof body.content !== 'string') {
    return NextResponse.json({ error: 'BadRequest', message: 'content 필드가 필요합니다.' }, { status: 400 })
  }

  const projectModule = await prisma.projectModule.findFirst({
    where: { id: params.moduleId, projectId: params.id },
  })

  if (!projectModule) {
    return NextResponse.json({ error: 'NotFound', message: '모듈을 찾을 수 없습니다.' }, { status: 404 })
  }

  const updated = await prisma.projectModule.update({
    where: { id: params.moduleId },
    data: { content: body.content },
    select: { id: true, content: true, updatedAt: true },
  })

  return NextResponse.json(updated)
}
