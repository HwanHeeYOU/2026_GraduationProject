import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'YourPark - IRB 심의 서류 작성 플랫폼',
  description: '연구자를 위한 모듈형 IRB 심의 서류 작성 SaaS 플랫폼. AI 기반 문장 초안 생성으로 빠르고 정확한 IRB 서류를 작성하세요.',
  keywords: ['IRB', '기관생명윤리위원회', '연구윤리', 'IRB 서류', '연구자'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
