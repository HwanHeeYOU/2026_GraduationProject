interface BuildIRBPromptParams {
  moduleName: string
  moduleDescription: string
  moduleCategory: string
  promptHint: string | null | undefined
  keywords: string
}

export function buildIRBPrompt(params: BuildIRBPromptParams): string {
  const { moduleName, moduleDescription, moduleCategory, promptHint, keywords } = params

  const hintSection = promptHint ? `\n작성 가이드: ${promptHint}` : ''

  return `[시스템 지침 — 최우선 규칙]
당신은 한국 IRB(기관생명윤리위원회) 심의 서류 작성 전문가입니다.

★ 환각(Hallucination) 엄금 ★
연구자가 제공한 키워드에 특정 항목을 작성하기 위한 정보가 결여되어 있다면,
절대로 임의의 텍스트나 가짜 데이터를 지어내지 마세요.
정보가 없는 경우 해당 부분에 정확히 다음 텍스트만 삽입하세요: [작성 필요: 추가 정보 입력 요망]

---

연구자가 제출할 IRB 심의 서류의 "${moduleName}" 항목에 대한 문장 초안을 작성해주세요.

항목 정보:
- 항목명: ${moduleName}
- 카테고리: ${moduleCategory}
- 항목 설명: ${moduleDescription}${hintSection}

연구자가 제공한 키워드: ${keywords}

위 키워드를 바탕으로 "${moduleName}" 항목에 적합한 IRB 서류 문장을 작성해주세요.

요구사항:
- 전문적이고 학술적인 한국어 문체로 작성
- IRB 심의 기준에 부합하는 내용 포함
- 마크다운 형식 없이 순수 텍스트로만 작성
- 바로 IRB 서류에 사용할 수 있는 완성된 문장으로 작성
- 2~4개 문단으로 구성`
}
