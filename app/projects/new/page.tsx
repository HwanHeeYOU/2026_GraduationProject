import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import DashboardLayout from '@/components/dashboard/DashboardLayout'
import NewProjectWizard from '@/components/projects/NewProjectWizard'

export default async function NewProjectPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    redirect('/auth/login')
  }

  return (
    <DashboardLayout userName={session.user.name ?? session.user.email}>
      <div
        className="relative min-h-full py-8 px-4"
        style={{
          backgroundImage: "url('/night-bg.jpg')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
        }}
      >
        <div className="absolute inset-0 bg-black/55 pointer-events-none" />
        <div className="relative z-10">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-white">새 프로젝트 만들기</h1>
            <p className="text-slate-400 text-sm mt-1">학교를 선택하고 IRB 항목을 구성하세요.</p>
          </div>
          <NewProjectWizard />
        </div>
      </div>
    </DashboardLayout>
  )
}
