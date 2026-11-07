import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hwpToHwpx } from '@/lib/hwp/hwpToHwpx'

const MAX_FILE_SIZE = 10 * 1024 * 1024

/**
 * POST /api/projects/:id/templates
 * multipart/form-data, 필드명 `file` (여러 개 가능).
 * 업로드한 기관 양식을 저장한다. (내보내기 때 이 양식에 답변을 채워 넣음)
 *  - .hwpx : 원본 그대로
 *  - .hwp  : 문단·표(행·열·병합·폭) 구조를 읽어 같은 구조의 .hwpx 로 변환해 저장 (파일 이름은 업로드한 이름 그대로)
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', message: '인증이 필요합니다.' }, { status: 401 })
  }

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: session.user.id },
    select: { id: true },
  })
  if (!project) {
    return NextResponse.json({ error: 'Not Found', message: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'BadRequest', message: '잘못된 요청입니다.' }, { status: 400 })
  }

  const files = formData
    .getAll('file')
    .filter((f): f is File => f instanceof File)
    .filter((f) => /\.hwpx?$/i.test(f.name) && f.size <= MAX_FILE_SIZE)

  const saved: string[] = []
  for (const f of files) {
    let data: Buffer = Buffer.from(await f.arrayBuffer())
    if (/\.hwp$/i.test(f.name)) {
      try {
        data = (await hwpToHwpx(data)).hwpx
      } catch (e) {
        console.error('[templates] hwp → hwpx 변환 실패:', f.name, e instanceof Error ? e.message : e)
        continue
      }
    }
    await prisma.projectTemplateFile.upsert({
      where: { projectId_fileName: { projectId: project.id, fileName: f.name } },
      create: { projectId: project.id, fileName: f.name, data },
      update: { data },
    })
    saved.push(f.name)
  }

  return NextResponse.json({ saved })
}
