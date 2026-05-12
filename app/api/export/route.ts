import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateDocx } from '@/lib/export/generateDocx'
import { generatePdf } from '@/lib/export/generatePdf'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '인증이 필요합니다.' }, { status: 401 })
  }

  let body: { projectId?: string; format?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad Request', message: '잘못된 요청입니다.' }, { status: 400 })
  }

  const { projectId, format } = body
  if (!projectId || !format || !['docx', 'pdf'].includes(format)) {
    return NextResponse.json(
      { error: 'Bad Request', message: 'projectId와 format(docx|pdf)이 필요합니다.' },
      { status: 400 }
    )
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    include: {
      institution: { select: { name: true } },
      modules: {
        include: { module: true },
        orderBy: { order: 'asc' },
      },
    },
  })

  if (!project) {
    return NextResponse.json({ error: 'Not Found', message: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }

  const exportProject = {
    name: project.name,
    institutionName: project.institution.name,
    modules: project.modules.map((pm) => ({
      name: pm.module.name,
      category: pm.module.category,
      content: pm.content,
      order: pm.order,
    })),
  }

try {
    if (format === 'docx') {
      const buffer = await generateDocx(exportProject)
      const filename = encodeURIComponent(`${project.name}.docx`)
      
      // Node.js Buffer를 Web 표준 Uint8Array로 변환
      const uint8Array = new Uint8Array(buffer)

      return new NextResponse(uint8Array, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
        },
      })
    } else {
      const buffer = generatePdf(exportProject)
      const filename = encodeURIComponent(`${project.name}.pdf`)
      
      // pdf 쪽도 동일하게 변환
      const uint8Array = new Uint8Array(buffer)

      return new NextResponse(uint8Array, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
        },
      })
    }
  } catch (err) {
    console.error('[export] error:', err)
    return NextResponse.json(
      { error: 'Internal Server Error', message: '내보내기에 실패했습니다. 다시 시도해 주세요.' },
      { status: 500 }
    )
  }
}
