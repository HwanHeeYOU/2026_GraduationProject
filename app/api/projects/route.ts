import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '인증이 필요합니다.' }, { status: 401 })
  }

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    include: {
      institution: { select: { id: true, name: true, shortName: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return NextResponse.json(projects)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '인증이 필요합니다.' }, { status: 401 })
  }

  let body: { name?: string; institutionId?: string; selectedModuleIds?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const { name, institutionId, selectedModuleIds } = body

  if (!name || !institutionId || !Array.isArray(selectedModuleIds) || selectedModuleIds.length === 0) {
    return NextResponse.json(
      { error: 'BadRequest', message: '프로젝트명, 학교, 모듈을 모두 선택해주세요.' },
      { status: 400 }
    )
  }

  try {
    // 선택된 모듈들의 order 정보 조회
    const modules = await prisma.iRBModule.findMany({
      where: { id: { in: selectedModuleIds } },
      select: { id: true, order: true },
    })

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name,
          userId: session.user.id,
          institutionId,
          status: 'DRAFT',
        },
      })

      await tx.projectModule.createMany({
        data: modules.map((m) => ({
          projectId: created.id,
          moduleId: m.id,
          content: '',
          order: m.order,
        })),
      })

      return tx.project.findUnique({
        where: { id: created.id },
        include: {
          institution: { select: { id: true, name: true, shortName: true } },
          modules: { include: { module: true }, orderBy: { order: 'asc' } },
        },
      })
    })

    return NextResponse.json(project, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: 'InternalServerError', message: '프로젝트 생성에 실패했습니다. 다시 시도해 주세요.' },
      { status: 500 }
    )
  }
}
