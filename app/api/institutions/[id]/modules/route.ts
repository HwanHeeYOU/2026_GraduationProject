import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const institutionModules = await prisma.institutionModule.findMany({
      where: { institutionId: params.id },
      include: {
        module: true,
      },
      orderBy: { priority: 'asc' },
    })

    if (institutionModules.length === 0) {
      const institution = await prisma.institution.findUnique({ where: { id: params.id } })
      if (!institution) {
        return NextResponse.json(
          { error: 'NotFound', message: '해당 학교를 찾을 수 없습니다.' },
          { status: 404 }
        )
      }
    }

    const modules = institutionModules.map((im: typeof institutionModules[number]) => ({
      id: im.module.id,
      name: im.module.name,
      description: im.module.description,
      category: im.module.category,
      isRequired: im.module.isRequired,
      order: im.module.order,
      hasFormula: im.module.hasFormula,
      promptHint: im.module.promptHint,
      institutionIsRequired: im.isRequired,
      priority: im.priority,
    }))

    return NextResponse.json({ modules })
  } catch {
    return NextResponse.json(
      { error: 'InternalServerError', message: '모듈 정보를 불러오는 데 실패했습니다. 다시 시도해 주세요.' },
      { status: 500 }
    )
  }
}
