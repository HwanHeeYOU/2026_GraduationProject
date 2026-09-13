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

interface BuildRevisionPromptParams {
  moduleName: string
  moduleDescription: string
  moduleCategory: string
  promptHint: string | null | undefined
  currentContent: string
  rejectionReason: string
}

export function buildRevisionPrompt(params: BuildRevisionPromptParams): string {
  const { moduleName, moduleDescription, moduleCategory, promptHint, currentContent, rejectionReason } = params

  const hintSection = promptHint ? `\n작성 가이드: ${promptHint}` : ''

  return `[시스템 지침 — 최우선 규칙]
당신은 한국 IRB(기관생명윤리위원회) 심의 서류 작성 전문가입니다.
연구자가 제출했던 IRB 서류가 심의위원회로부터 반려되었고, 반려 사유를 바탕으로 해당 항목을 수정해야 합니다.

★ 환각(Hallucination) 엄금 ★
반려 사유나 기존 내용에 없는 새로운 사실, 수치, 절차를 임의로 지어내지 마세요.
반려 사유를 반영하기 위해 연구자가 직접 제공해야 하는 정보가 있다면,
절대로 임의의 텍스트나 가짜 데이터를 지어내지 말고 해당 부분에 정확히 다음 텍스트만 삽입하세요: [작성 필요: 추가 정보 입력 요망]

---

항목 정보:
- 항목명: ${moduleName}
- 카테고리: ${moduleCategory}
- 항목 설명: ${moduleDescription}${hintSection}

기존 작성 내용:
"""
${currentContent || '(작성된 내용 없음)'}
"""

심의위원회 반려 사유:
"""
${rejectionReason}
"""

위 반려 사유를 반영하여 "${moduleName}" 항목의 내용을 수정해주세요.

요구사항:
- 반려 사유에서 지적된 문제를 명확히 해소하는 방향으로 수정
- 기존 내용 중 반려 사유와 무관하고 문제 없는 부분은 최대한 유지
- 전문적이고 학술적인 한국어 문체로 작성
- IRB 심의 기준에 부합하는 내용 포함
- 마크다운 형식 없이 순수 텍스트로만 작성
- 바로 IRB 서류에 사용할 수 있는 완성된 문장으로 작성
- 수정된 최종 본문만 출력하고, 설명이나 안내 문구는 포함하지 말 것`
}
