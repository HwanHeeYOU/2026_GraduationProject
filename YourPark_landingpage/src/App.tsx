import { useState } from 'react';
import imgBackground from "figma:asset/051b28689fb2a6b0c77b4d8ce5839c4745c51087.png";

function MenuButton() {
  return (
    <div className="h-2.5 relative w-[17px]">
      <div className="absolute bottom-[-5%] left-0 right-0 top-[-5%]">
        <svg
          className="block size-full"
          fill="none"
          preserveAspectRatio="none"
          viewBox="0 0 17 12"
        >
          <g id="Group 2085665467">
            <path
              d="M17 6L10.9412 6L5.85087 1H0"
              id="Vector 10"
              stroke="white"
            />
            <path
              d="M0 6L6.05882 6L11.1491 11H17"
              id="Vector 12"
              stroke="white"
            />
            <path
              d="M17 1H10.5"
              id="Vector 11"
              stroke="white"
            />
            <path
              d="M6.5 11H0"
              id="Vector 13"
              stroke="white"
            />
          </g>
        </svg>
      </div>
    </div>
  );
}

function ArrowIcon({ className = "" }) {
  return (
    <div className={`h-[11px] w-[19px] ${className}`}>
      <svg
        className="block size-full"
        fill="none"
        preserveAspectRatio="none"
        viewBox="0 0 20 13"
      >
        <path
          d="M19 6.5L10.5 12.5L2 6.5"
          stroke="currentColor"
        />
      </svg>
    </div>
  );
}

function Header() {
  return (
    <header className="absolute top-0 left-0 right-0 z-10 p-4 md:p-8">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        {/* Logo */}
        <div className="flex-1 flex justify-start">
          <div className="text-white text-2xl md:text-3xl font-light tracking-[-0.5px]">
            YourPark
          </div>
        </div>

        {/* Stats - Hidden on mobile */}
        <div className="hidden lg:flex items-center gap-8 flex-1 justify-center">
          <div className="text-white text-sm font-medium tracking-[-0.28px] text-center">
            <div className="text-white/90">50+</div>
            <div className="text-white/70 text-xs">기관파트너</div>
          </div>
          <div className="w-px h-8 bg-white/20" />
          <div className="text-white text-sm font-medium tracking-[-0.28px] text-center">
            <div className="text-white/90">99.5%</div>
            <div className="text-white/70 text-xs">규정 준수 성공률</div>
          </div>
        </div>

        {/* Menu */}
        <div className="flex items-center gap-4 flex-1 justify-end">
          <div className="flex items-center gap-3 cursor-pointer">
            <div className="rotate-180 scale-y-[-1]">
              <MenuButton />
            </div>
            <span className="text-white text-sm font-medium tracking-[-0.28px]">
              Menu
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

function HeroSection() {
  return (
    <section 
      className="relative h-screen min-h-[800px] bg-black flex items-start pt-[25vh]"
      style={{
        backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.3) 0%, rgba(0, 0, 0, 0.5) 100%), url('${imgBackground}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      <div className="max-w-7xl mx-auto px-4 md:px-8 w-full">
        <div className="space-y-6">
          {/* Main Heading */}
          <h1 className="text-5xl md:text-7xl lg:text-[96px] font-bold text-white leading-[1.1] tracking-[-2px]">
            YourPark
          </h1>

          {/* Subtitle */}
          <p className="text-white/90 text-xl md:text-2xl lg:text-3xl font-bold tracking-[-0.5px] leading-[1.5]">
            당신의 IRB생성의 전문가
          </p>

          {/* Mobile Stats */}
          <div className="lg:hidden flex items-center gap-8 pt-8">
            <div className="text-white text-sm font-medium tracking-[-0.28px] text-center">
              <div className="text-white/90 text-lg">50+</div>
              <div className="text-white/70 text-xs">기관파트너</div>
            </div>
            <div className="w-px h-12 bg-white/20" />
            <div className="text-white text-sm font-medium tracking-[-0.28px] text-center">
              <div className="text-white/90 text-lg">99.5%</div>
              <div className="text-white/70 text-xs">규정 준수 성공률</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-white">
      {/* Main Content */}
      <div>
        <Header />
        <HeroSection />
      </div>
    </div>
  );
}