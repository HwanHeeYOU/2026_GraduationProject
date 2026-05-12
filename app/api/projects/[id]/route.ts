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
    include: {
      institution: true,
      modules: { include: { module: true }, orderBy: { order: 'asc' } },
    },
  })

  if (!project) {
    return NextResponse.json({ error: 'Not Found', message: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }

  return NextResponse.json(project)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '인증이 필요합니다.' }, { status: 401 })
  }

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: session.user.id },
  })

  if (!project) {
    return NextResponse.json({ error: 'Not Found', message: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }

  const body = await req.json()
  const updated = await prisma.project.update({
    where: { id: params.id },
    data: { name: body.name, status: body.status },
  })

  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '인증이 필요합니다.' }, { status: 401 })
  }

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: session.user.id },
  })

  if (!project) {
    return NextResponse.json({ error: 'Not Found', message: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }

  await prisma.project.delete({ where: { id: params.id } })

  return NextResponse.json({ success: true })
}
