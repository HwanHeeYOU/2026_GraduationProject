import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateDocx } from '@/lib/export/generateDocx'
import { generatePdf } from '@/lib/export/generatePdf'
import { fillHwpx } from '@/lib/export/fillHwpx'
import { parseStoredDraft } from '@/lib/irb/draftStore'
import JSZip from 'jszip'

async function exportHwpx(
  projectId: string,
  projectName: string,
  cols: { formDraftJson: string | null; draftOutputJson: string | null; userInputJson: string | null },
) {
  // 새 컬럼(draftOutputJson) 우선, 예전 프로젝트는 formDraftJson 의 legacy 형태도 읽는다
  const output = parseStoredDraft(cols).output
  if (!output) {
    return NextResponse.json(
      { error: 'Unprocessable', message: '작성된 초안이 없습니다. 먼저 문항별 초안을 생성해 주세요.' },
      { status: 422 }
    )
  }

  const templates = await prisma.projectTemplateFile.findMany({ where: { projectId } })
  if (templates.length === 0) {
    return NextResponse.json(
      {
        error: 'Unprocessable',
        message: '업로드된 HWPX 양식이 없습니다. HWPX 양식 파일을 다시 업로드한 뒤 초안을 생성해 주세요.',
      },
      { status: 422 }
    )
  }

  try {
    const results: Array<{ fileName: string; buffer: Buffer; unmatched: number; filled: number }> = []
    for (const tpl of templates) {
      const section = output.sections.find((s) => s.fileName === tpl.fileName)
      if (!section) continue
      const r = await fillHwpx(Buffer.from(tpl.data), section.items)
      results.push({ fileName: tpl.fileName.replace(/\.hwp$/i, '.hwpx'), buffer: r.buffer, unmatched: r.unmatched.length, filled: r.filled })
    }
    if (results.length === 0) {
      return NextResponse.json(
        { error: 'Unprocessable', message: '업로드한 양식과 일치하는 초안 항목이 없습니다.' },
        { status: 422 }
      )
    }

    const unmatched = results.reduce((s, r) => s + r.unmatched, 0)
    const filled = results.reduce((s, r) => s + r.filled, 0)
    const meta = { 'X-Hwpx-Filled': String(filled), 'X-Hwpx-Unmatched': String(unmatched) }

    if (results.length === 1) {
      const filename = encodeURIComponent(results[0].fileName)
      return new NextResponse(new Uint8Array(results[0].buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/hwp+zip',
          'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
          ...meta,
        },
      })
    }

    // 양식이 여러 개면 ZIP으로 묶어서 내려준다
    const zip = new JSZip()
    for (const r of results) zip.file(r.fileName, r.buffer)
    const zipped = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    const filename = encodeURIComponent(`${projectName}.zip`)
    return new NextResponse(new Uint8Array(zipped), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
        ...meta,
      },
    })
  } catch (err) {
    console.error('[export:hwpx] error:', err)
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'HWPX 내보내기에 실패했습니다. 다시 시도해 주세요.' },
      { status: 500 }
    )
  }
}

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
  if (!projectId || !format || !['docx', 'pdf', 'hwpx'].includes(format)) {
    return NextResponse.json(
      { error: 'Bad Request', message: 'projectId와 format(docx|pdf|hwpx)이 필요합니다.' },
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

  // ── HWPX: 업로드한 기관 양식에 초안 답변을 채워서 내보낸다 ─────────
  if (format === 'hwpx') {
    return exportHwpx(project.id, project.name, project)
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
