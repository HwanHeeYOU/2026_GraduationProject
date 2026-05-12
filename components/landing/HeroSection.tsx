'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'

const AuthModal = dynamic(() => import('@/components/auth/AuthModal'), { ssr: false })

type ModalMode = 'login' | 'register' | null

export default function HeroSection() {
  const [modalMode, setModalMode] = useState<ModalMode>(null)

  return (
    <>
      <section
        className="relative min-h-screen flex items-start pt-[22vh] overflow-hidden"
        style={{
          backgroundImage: "url('/night-bg.jpg')",
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {/* Dark overlay for readability */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(5,10,25,0.65) 100%)' }}
          aria-hidden="true"
        />

        {/* Radial glow accents */}
        <div
          className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%)' }}
          aria-hidden="true"
        />

        <div className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 w-full">
          <div className="space-y-6 max-w-3xl">
            {/* Main heading */}
            <h1 className="text-6xl md:text-8xl lg:text-[96px] font-bold text-white leading-[1.05] tracking-[-2px]">
              YourPark
            </h1>

            {/* Subtitle */}
            <p className="text-white/90 text-xl md:text-2xl lg:text-3xl font-bold tracking-[-0.5px] leading-relaxed">
              당신의 IRB생성의 전문가
            </p>

            {/* Mobile trust indicators */}
            <div className="lg:hidden flex items-center gap-8 pt-4">
              <div className="text-center">
                <div className="text-white/90 text-lg font-semibold">50+</div>
                <div className="text-white/70 text-xs">기관 파트너</div>
              </div>
              <div className="w-px h-10 bg-white/20" />
              <div className="text-center">
                <div className="text-white/90 text-lg font-semibold">99.5%</div>
                <div className="text-white/70 text-xs">규정 준수 성공률</div>
              </div>
            </div>

            {/* CTA Buttons — open modal instead of navigating */}
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <button
                onClick={() => setModalMode('login')}
                className="glass-button inline-flex items-center justify-center px-8 py-4 rounded-xl text-white font-semibold text-base tracking-[-0.3px] hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                지금 바로 시작하기
              </button>
              <button
                onClick={() => setModalMode('register')}
                className="inline-flex items-center justify-center px-8 py-4 rounded-xl text-white font-semibold text-base tracking-[-0.3px] border border-white/30 bg-white/5 backdrop-blur-sm hover:bg-white/10 hover:border-white/50 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                무료로 항목 진단받기
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Auth Modal */}
      {modalMode && (
        <AuthModal
          initialMode={modalMode}
          onClose={() => setModalMode(null)}
        />
      )}
    </>
  )
}
