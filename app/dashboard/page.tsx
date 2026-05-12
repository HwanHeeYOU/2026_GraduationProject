import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import DashboardLayout from '@/components/dashboard/DashboardLayout'
import DashboardClient from '@/components/dashboard/DashboardClient'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    redirect('/auth/login')
  }

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    include: {
      institution: { select: { id: true, name: true, shortName: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return (
    <DashboardLayout userName={session.user.name ?? session.user.email}>
      <DashboardClient initialProjects={projects} />
    </DashboardLayout>
  )
}
