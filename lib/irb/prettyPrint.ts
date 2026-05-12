import type { IRBModuleData } from './parser'
import { parseIRBModule, type ParseResult } from './parser'

export function prettyPrintIRBModule(module: IRBModuleData): string {
  const lines = [
    '[IRBModule]',
    `name: ${module.name}`,
    `description: ${module.description}`,
    `category: ${module.category}`,
    `isRequired: ${module.isRequired}`,
    `order: ${module.order}`,
    `hasFormula: ${module.hasFormula ?? false}`,
    `promptHint: ${module.promptHint ?? null}`,
  ]
  return lines.join('\n')
}

/**
 * prettyPrint 출력을 다시 파싱합니다 (round-trip 지원).
 * parseIRBModule은 일반 객체도 받으므로, 텍스트 형식을 파싱하여 객체로 변환 후 전달합니다.
 */
export function parsePrettyPrinted(text: string): ParseResult<IRBModuleData> {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '[IRBModule]') {
    return { success: false, error: '[IRBModule] 헤더가 없습니다.', missingFields: [] }
  }

  const obj: Record<string, unknown> = {}
  for (const line of lines.slice(1)) {
    const colonIdx = line.indexOf(': ')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const rawValue = line.slice(colonIdx + 2)

    if (key === 'isRequired' || key === 'hasFormula') {
      obj[key] = rawValue === 'true'
    } else if (key === 'order') {
      obj[key] = Number(rawValue)
    } else if (key === 'promptHint') {
      obj[key] = rawValue === 'null' ? null : rawValue
    } else {
      obj[key] = rawValue
    }
  }

  return parseIRBModule(obj)
}
