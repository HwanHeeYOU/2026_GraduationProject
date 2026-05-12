const features = [
  {
    icon: '🏫',
    title: '학교별 맞춤',
    description:
      '소속 학교를 선택하면 해당 기관의 IRB 심의 기준에 맞는 항목이 자동으로 로드됩니다. 학교별 필수 항목을 놓치지 마세요.',
  },
  {
    icon: '🤖',
    title: 'AI 초안 생성',
    description:
      'Claude Sonnet AI가 연구 키워드를 기반으로 각 IRB 항목에 최적화된 문장 초안을 자동으로 생성합니다.',
  },
  {
    icon: '✅',
    title: '최종 검토',
    description:
      '작성된 모든 항목을 한 페이지에서 검토하고 DOCX 또는 PDF로 즉시 내보낼 수 있습니다.',
  },
]

export default function FeaturesSection() {
  return (
    <section
      className="relative py-24 px-4 md:px-8"
      style={{
        backgroundImage: "url('/night-bg.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center 60%',
        backgroundAttachment: 'fixed',
      }}
    >
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
      <div className="relative z-10 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-[-1px] mb-4">
            IRB 서류 작성, 이제 쉽게
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto">
            복잡한 IRB 심의 서류를 단계별로 안내하고 AI가 초안을 생성해 드립니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((feature) => (
            <div key={feature.title} className="glass-card p-8 flex flex-col gap-4">
              <div className="text-4xl">{feature.icon}</div>
              <h3 className="text-white font-bold text-xl tracking-[-0.5px]">
                {feature.title}
              </h3>
              <p className="text-white/60 text-sm leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
