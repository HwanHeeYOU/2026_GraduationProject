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

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => null)
    const name = (body as { name?: string } | null)?.name?.trim()
    const category = (body as { category?: string } | null)?.category?.trim()
    const description = (body as { description?: string } | null)?.description?.trim() ?? ''
    const isRequired = Boolean((body as { isRequired?: boolean } | null)?.isRequired)

    if (!name || !category) {
      return NextResponse.json(
        { error: 'BadRequest', message: '이름과 카테고리가 필요합니다.' },
        { status: 400 }
      )
    }

    const institution = await prisma.institution.findUnique({ where: { id: params.id } })
    if (!institution) {
      return NextResponse.json(
        { error: 'NotFound', message: '해당 학교를 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    // 같은 기관에 동일한 이름의 모듈이 이미 연결되어 있으면 기존 항목 반환 (중복 방지)
    const existingLink = await prisma.institutionModule.findFirst({
      where: {
        institutionId: params.id,
        module: { name },
      },
      include: { module: true },
    })
    if (existingLink) {
      return NextResponse.json({
        module: {
          id: existingLink.module.id,
          name: existingLink.module.name,
          description: existingLink.module.description,
          category: existingLink.module.category,
          isRequired: existingLink.module.isRequired,
          order: existingLink.module.order,
          hasFormula: existingLink.module.hasFormula,
          promptHint: existingLink.module.promptHint,
          institutionIsRequired: existingLink.isRequired,
          priority: existingLink.priority,
        },
      })
    }

    const [maxOrder, maxPriority] = await Promise.all([
      prisma.iRBModule.aggregate({ _max: { order: true } }),
      prisma.institutionModule.aggregate({
        where: { institutionId: params.id },
        _max: { priority: true },
      }),
    ])

    const module = await prisma.iRBModule.create({
      data: {
        name,
        description,
        category,
        order: (maxOrder._max.order ?? 0) + 1,
      },
    })

    const institutionModule = await prisma.institutionModule.create({
      data: {
        institutionId: params.id,
        moduleId: module.id,
        priority: (maxPriority._max.priority ?? 0) + 1,
        isRequired,
      },
    })

    return NextResponse.json({
      module: {
        id: module.id,
        name: module.name,
        description: module.description,
        category: module.category,
        isRequired: module.isRequired,
        order: module.order,
        hasFormula: module.hasFormula,
        promptHint: module.promptHint,
        institutionIsRequired: institutionModule.isRequired,
        priority: institutionModule.priority,
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'InternalServerError', message: '모듈 추가에 실패했습니다. 다시 시도해 주세요.' },
      { status: 500 }
    )
  }
}
