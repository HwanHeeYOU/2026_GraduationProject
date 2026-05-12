export interface IRBModuleData {
  name: string
  description: string
  category: string
  isRequired: boolean
  order: number
  hasFormula?: boolean
  promptHint?: string | null
}

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; missingFields: string[] }

const REQUIRED_FIELDS: Array<keyof IRBModuleData> = [
  'name',
  'description',
  'category',
  'isRequired',
  'order',
]

export function parseIRBModule(input: unknown): ParseResult<IRBModuleData> {
  if (typeof input !== 'object' || input === null) {
    return {
      success: false,
      error: '입력값이 객체가 아닙니다.',
      missingFields: REQUIRED_FIELDS as string[],
    }
  }

  const obj = input as Record<string, unknown>
  const missingFields: string[] = []

  // 필수 필드 존재 및 타입 검사
  if (typeof obj.name !== 'string') missingFields.push('name')
  if (typeof obj.description !== 'string') missingFields.push('description')
  if (typeof obj.category !== 'string') missingFields.push('category')
  if (typeof obj.isRequired !== 'boolean') missingFields.push('isRequired')
  if (typeof obj.order !== 'number') missingFields.push('order')

  if (missingFields.length > 0) {
    return {
      success: false,
      error: `필수 필드가 누락되었거나 타입이 올바르지 않습니다: ${missingFields.join(', ')}`,
      missingFields,
    }
  }

  const data: IRBModuleData = {
    name: obj.name as string,
    description: obj.description as string,
    category: obj.category as string,
    isRequired: obj.isRequired as boolean,
    order: obj.order as number,
  }

  if (typeof obj.hasFormula === 'boolean') {
    data.hasFormula = obj.hasFormula
  }

  if (obj.promptHint !== undefined) {
    data.promptHint = typeof obj.promptHint === 'string' ? obj.promptHint : null
  }

  return { success: true, data }
}
