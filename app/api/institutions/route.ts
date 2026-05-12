import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const institutions = await prisma.institution.findMany({
      select: { id: true, name: true, shortName: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(institutions)
  } catch {
    return NextResponse.json(
      { error: 'InternalServerError', message: '학교 정보를 불러오는 데 실패했습니다. 다시 시도해 주세요.' },
      { status: 500 }
    )
  }
}
