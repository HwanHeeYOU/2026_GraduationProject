import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '인증이 필요합니다.' }, { status: 401 })
  }

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: session.user.id },
  })

  if (!project) {
    return NextResponse.json({ error: 'NotFound', message: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }

  const notes = await prisma.rejectionNote.findMany({
    where: { projectId: params.id },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(notes)
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '인증이 필요합니다.' }, { status: 401 })
  }

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: session.user.id },
  })

  if (!project) {
    return NextResponse.json({ error: 'NotFound', message: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }

  let body: { reason?: string; projectModuleId?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const reason = body.reason?.trim()
  if (!reason) {
    return NextResponse.json({ error: 'BadRequest', message: '반려 사유를 입력해 주세요.' }, { status: 400 })
  }

  if (body.projectModuleId) {
    const mod = await prisma.projectModule.findFirst({
      where: { id: body.projectModuleId, projectId: params.id },
    })
    if (!mod) {
      return NextResponse.json({ error: 'BadRequest', message: '해당 모듈을 찾을 수 없습니다.' }, { status: 400 })
    }
  }

  const [note] = await prisma.$transaction([
    prisma.rejectionNote.create({
      data: {
        projectId: params.id,
        projectModuleId: body.projectModuleId ?? null,
        reason,
      },
    }),
    prisma.project.update({
      where: { id: params.id },
      data: { status: 'REJECTED' },
    }),
  ])

  return NextResponse.json(note, { status: 201 })
}
