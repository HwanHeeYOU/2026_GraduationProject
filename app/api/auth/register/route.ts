import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'BAD_REQUEST', message: '이메일과 비밀번호를 입력해주세요.' },
        { status: 400 }
      )
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: 'CONFLICT', message: '이미 사용 중인 이메일입니다.' },
        { status: 409 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name ?? null,
      },
      select: { id: true, email: true, name: true, createdAt: true },
    })

    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    console.error('[register]', error)
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
