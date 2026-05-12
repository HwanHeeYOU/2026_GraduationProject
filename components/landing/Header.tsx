'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'

function MenuIcon() {
  return (
    <div className="h-2.5 relative w-[17px]">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 17 12">
        <g>
          <path d="M17 6L10.9412 6L5.85087 1H0" stroke="white" />
          <path d="M0 6L6.05882 6L11.1491 11H17" stroke="white" />
          <path d="M17 1H10.5" stroke="white" />
          <path d="M6.5 11H0" stroke="white" />
        </g>
      </svg>
    </div>
  )
}

const menuSections = [
  {
    title: "What's YourPark?",
    content:
      'YourPark는 연구자를 위한 모듈형 IRB 심의 서류 작성 SaaS 플랫폼입니다. 복잡한 IRB 서류를 AI와 함께 빠르고 정확하게 완성하세요.',
  },
  {
    title: '학교별 맞춤 항목',
    content:
      '소속 학교를 선택하면 해당 기관의 IRB 심의 기준에 맞는 항목이 자동으로 로드됩니다. 학교별 필수 항목을 놓치지 않도록 도와드립니다.',
  },
  {
    title: 'AI 초안 생성',
    content:
      'Claude Sonnet AI가 연구 키워드를 기반으로 각 IRB 항목에 최적화된 문장 초안을 자동으로 생성합니다. 작성 시간을 획기적으로 단축하세요.',
  },
  {
    title: '최종 검토 & 내보내기',
    content:
      '작성된 모든 항목을 한 페이지에서 검토하고 DOCX 또는 PDF로 즉시 내보낼 수 있습니다. 제출 준비 완료.',
  },
  {
    title: '신뢰 지표',
    content: '50+ 기관 파트너와 함께하며 99.5%의 규정 준수 성공률을 자랑합니다.',
  },
]

export default function Header() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <header className="absolute top-0 left-0 right-0 z-20 p-4 md:p-8">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          {/* Logo */}
          <div className="flex-1 flex justify-start">
            <Link
              href="/"
              className="text-white text-2xl md:text-3xl font-light tracking-[-0.5px] hover:opacity-80 transition-opacity"
            >
              YourPark
            </Link>
          </div>

          {/* Trust Indicators - Desktop */}
          <div className="hidden lg:flex items-center gap-8 flex-1 justify-center">
            <div className="text-center">
              <div className="text-white/90 text-base font-semibold">50+</div>
              <div className="text-white/70 text-xs">기관 파트너</div>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div className="text-center">
              <div className="text-white/90 text-base font-semibold">99.5%</div>
              <div className="text-white/70 text-xs">규정 준수 성공률</div>
            </div>
          </div>

          {/* Menu button */}
          <div className="flex items-center gap-4 flex-1 justify-end">
            <button
              onClick={() => setOpen(true)}
              className="flex items-center gap-3 cursor-pointer group"
              aria-label="메뉴 열기"
            >
              <div className="rotate-180 scale-y-[-1]">
                <MenuIcon />
              </div>
              <span className="text-white text-sm font-medium tracking-[-0.28px] group-hover:opacity-80 transition-opacity">
                Menu
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Sidebar overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onClick={() => setOpen(false)}
        >
          {/* Dim backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

          {/* Sidebar panel — slides in from right */}
          <div
            className="relative h-full w-full max-w-sm flex flex-col overflow-y-auto"
            style={{
              background: 'rgba(15, 20, 45, 0.45)',
              backdropFilter: 'blur(32px)',
              WebkitBackdropFilter: 'blur(32px)',
              borderLeft: '1px solid rgba(255,255,255,0.14)',
              boxShadow: '-12px 0 60px rgba(0,0,0,0.5), inset 1px 0 0 rgba(255,255,255,0.06)',
              animation: 'slideInRight 0.32s cubic-bezier(0.22,1,0.36,1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <div className="flex items-center justify-between px-8 pt-8 pb-6 border-b border-white/10">
              <span className="text-white text-xl font-light tracking-tight">YourPark</span>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-white transition-colors"
                aria-label="메뉴 닫기"
              >
                <X size={20} />
              </button>
            </div>

            {/* Menu sections */}
            <div className="flex flex-col gap-0 px-8 py-6 flex-1">
              {menuSections.map((section, i) => (
                <div
                  key={i}
                  className="py-6 border-b border-white/8 last:border-0"
                >
                  <h3 className="text-white font-semibold text-base mb-2 tracking-tight">
                    {section.title}
                  </h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    {section.content}
                  </p>
                </div>
              ))}
            </div>

            {/* Bottom CTA */}
            <div className="px-8 pb-8 pt-4 border-t border-white/10">
              <p className="text-slate-500 text-xs text-center">
                © {new Date().getFullYear()} YourPark. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Slide-in animation */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  )
}
