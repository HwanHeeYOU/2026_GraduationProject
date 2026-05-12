export default function Footer() {
  return (
    <footer
      className="relative py-10 px-4 md:px-8 border-t border-white/10"
      style={{
        backgroundImage: "url('/night-bg.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center bottom',
      }}
    >
      <div className="absolute inset-0 bg-black/70" aria-hidden="true" />
      <div className="relative z-10 max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="text-white/80 font-light text-lg tracking-[-0.3px]">
          YourPark
        </div>
        <p className="text-white/40 text-sm">
          © {new Date().getFullYear()} YourPark. All rights reserved.
        </p>
        <p className="text-white/40 text-xs">
          IRB 심의 서류 작성 플랫폼
        </p>
      </div>
    </footer>
  )
}
