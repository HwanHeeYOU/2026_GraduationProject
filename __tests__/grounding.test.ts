// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { verifyGrounded, verifyAnswer, numbersIn, quoteCoverage, normalizeForMatch } from '@/lib/irb/grounding'

const SOURCE = `연구제목은 '작업기억 훈련이 실행기능에 미치는 영향'입니다. 연구책임자는 김민수이고 한국대학교 심리학과 조교수입니다.
공동연구자는 박서연(한국대학교 심리학과, 부교수)입니다. 연구기간은 IRB 승인 후부터 2027년 12월 31일까지입니다.
예산: 인건비 연구보조원 2명 12개월 24,000,000원.`

describe('verifyGrounded', () => {
  it('입력 원문을 그대로 인용한 답변은 통과한다', () => {
    const v = verifyGrounded('김민수', '연구책임자는 김민수이고 한국대학교 심리학과 조교수입니다', SOURCE)
    expect(v.ok).toBe(true)
  })

  it('띄어쓰기·문장부호만 다른 인용도 통과한다', () => {
    expect(verifyGrounded('2027년 12월 31일', 'IRB 승인 후부터 2027년 12월 31일 까지', SOURCE).ok).toBe(true)
  })

  it('지어낸 답변은 거부한다', () => {
    expect(verifyGrounded('연구 참여자에게 회당 사례비를 지급합니다', '없음', SOURCE).ok).toBe(false)
    expect(verifyGrounded('연구 참여자에게 회당 사례비를 지급합니다', '', SOURCE).ok).toBe(false)
  })

  it('답변이 입력과 비슷해도, 입력을 그대로 인용한 근거가 없으면 거부한다', () => {
    expect(verifyGrounded('김민수 조교수', '없음', SOURCE)).toMatchObject({ ok: false, reason: 'no-evidence' })
  })

  it('입력에 없는 문장을 근거라고 인용하면 거부한다 (가짜 인용)', () => {
    const v = verifyGrounded('김민수 조교수', '연구책임자 김민수 교수가 직접 사례비를 지급한다고 입력했습니다', SOURCE)
    expect(v).toMatchObject({ ok: false, reason: 'evidence-not-in-input' })
  })

  it('입력에 없는 숫자(금액·기간)가 답변에 있으면 근거가 있어도 거부한다', () => {
    const v = verifyGrounded('사례비: 참여당 10,000원', '인건비 연구보조원 2명 12개월 24,000,000원', SOURCE)
    expect(v).toMatchObject({ ok: false, reason: 'number-not-in-input', detail: '10000' })
    expect(verifyGrounded('1회 참여당 사례비 지급', '연구책임자는 김민수이고', SOURCE).ok).toBe(false)
    expect(verifyGrounded('연구 종료 후 5년 보관', '연구기간은 IRB 승인 후부터 2027년 12월 31일까지입니다', SOURCE).ok).toBe(false)
  })

  it('입력에 있는 숫자는 쉼표 표기가 달라도 통과한다', () => {
    expect(verifyGrounded('인건비 24000000원', '인건비 연구보조원 2명 12개월 24,000,000원', SOURCE).ok).toBe(true)
  })

  it('번호 매기기(1., 2단계)는 숫자로 치지 않는다', () => {
    expect(numbersIn('1. 모집\n2) 동의\n3단계 분석')).toEqual([])
    expect(verifyGrounded('1. 연구책임자 김민수', '연구책임자는 김민수이고', SOURCE).ok).toBe(true)
  })

  // 실제 Luxia 실험에서 나온 사례: 근거는 입력에서 인용했지만 답변은 지어낸 경우
  const SRC2 = `연구참여로 인한 위험은 과제 수행 중 일시적인 피로감 정도입니다. 피로를 호소하면 즉시 휴식을 제공하며 보상계획은 없습니다.
참여자가 동의를 철회하면 그때까지 수집된 자료는 즉시 폐기합니다. 연구제목은 '작업기억 훈련이 실행기능에 미치는 영향'입니다.`

  it('조사·어미만 바꾼 답변은 통과한다', () => {
    expect(verifyGrounded('과제 수행 중 피로감을 호소하면 즉시 휴식을 제공합니다. 보상계획은 없습니다.', '피로를 호소하면 즉시 휴식을 제공하며 보상계획은 없습니다', SRC2).ok).toBe(true)
  })

  it('근거를 입력에서 인용해도 답변에 입력에 없는 문장이 있으면 거부한다', () => {
    const cases = [
      '연구대상자의 자료는 연구 종료 후 즉시 폐기합니다. 동의 철회 시 그때까지 수집된 자료도 즉시 폐기합니다.',
      '위험은 과제 수행 중 일시적인 피로감 정도이며, 이익으로는 작업기억 훈련이 실행기능에 미치는 영향에 대한 과학적 지식이 증진될 수 있습니다.',
      '연구대상자에게 연구 목적, 방법, 참여에 대한 위험과 이익을 설명한 후 서면 동의를 받습니다.',
    ]
    for (const answer of cases) {
      const v = verifyGrounded(answer, '참여자가 동의를 철회하면 그때까지 수집된 자료는 즉시 폐기합니다', SRC2)
      expect(v, answer).toMatchObject({ ok: false, reason: 'answer-not-in-input' })
    }
  })

  it('답변 전체가 입력에 그대로 들어 있으면 근거 인용이 없어도 통과한다 (개별 입력값을 그대로 쓴 경우)', () => {
    expect(verifyGrounded('한국대학교 심리학과 조교수', '', SOURCE).ok).toBe(true)
  })
})

describe('verifyAnswer (주제 검사)', () => {
  // 실제 Luxia 실험에서 나온 사례들
  const SRC = `연구제목은 '작업기억 훈련이 실행기능에 미치는 영향'입니다. 연구책임자는 김민수이고 한국대학교 심리학과 조교수입니다.
공동연구자는 박서연(한국대학교 심리학과, 부교수)이고 연구원은 이도윤(한국대학교 대학원 심리학과, 석사과정 대학원생)입니다.
연구 소속기관은 한국대학교 심리학과이고 주소는 (04763) 서울특별시 성동구 왕십리로 222입니다. 연구비 지원기관은 없습니다.
연구기간은 IRB 승인 후부터 2027년 12월 31일까지입니다.
연구참여로 인한 위험은 과제 수행 중 일시적인 피로감 정도입니다. 피로를 호소하면 즉시 휴식을 제공하며 보상계획은 없습니다.
개인정보는 이름과 연락처만 수집하며 제3자에게 제공하지 않습니다.
참여자가 동의를 철회하면 그때까지 수집된 자료는 즉시 폐기합니다.`

  it.each([
    ['관찰 항목', '과제 수행 중 일시적인 피로감', '연구참여로 인한 위험은 과제 수행 중 일시적인 피로감 정도입니다'],
    ['사례비 지급 규정', '보상계획은 없습니다.', '피로를 호소하면 즉시 휴식을 제공하며 보상계획은 없습니다'],
    ['제공기관 설명', '한국대학교 심리학과', '연구 소속기관은 한국대학교 심리학과이고'],
    ['연구 목적', '작업기억 훈련이 실행기능에 미치는 영향', "연구제목은 '작업기억 훈련이 실행기능에 미치는 영향'입니다"],
    ['연구대상자 모집 시 사생활 보호와 비밀유지 단계', '이름과 연락처만 수집하며 제3자에게 제공하지 않습니다.', '개인정보는 이름과 연락처만 수집하며 제3자에게 제공하지 않습니다'],
  ])('다른 주제의 입력 문장을 옮겨 온 답은 막지 않고 확인 권장으로 표시한다: %s', (q, a, e) => {
    expect(verifyAnswer(q, a, e, SRC)).toMatchObject({ ok: true, warning: 'off-topic' })
  })

  it.each([
    ['연구책임자 성명', '김민수', '연구책임자는 김민수이고'],
    ['성명', '김민수', '연구책임자는 김민수이고'],
    ['소속', '한국대학교 심리학과', '연구책임자는 김민수이고 한국대학교 심리학과 조교수입니다'],
    ['직위', '조교수', '연구책임자는 김민수이고 한국대학교 심리학과 조교수입니다'],
    ['소속기관명', '한국대학교 심리학과', '연구 소속기관은 한국대학교 심리학과이고'],
    ['연구원 직위', '석사과정 대학원생', '연구원은 이도윤(한국대학교 대학원 심리학과, 석사과정 대학원생)입니다'],
    ['연구기간', 'IRB 승인 후부터 2027년 12월 31일까지', '연구기간은 IRB 승인 후부터 2027년 12월 31일까지입니다'],
    ['연구비 지원기관명 및 주소', '없음', '연구비 지원기관은 없습니다'],
    ['안전대책 및 보상방안', '피로를 호소하면 즉시 휴식을 제공하며 보상계획은 없습니다.', '피로를 호소하면 즉시 휴식을 제공하며 보상계획은 없습니다'],
    ['연구참여로 발생할 수 있는 위험', '과제 수행 중 일시적인 피로감', '연구참여로 인한 위험은 과제 수행 중 일시적인 피로감 정도입니다'],
    ['개인정보 수집 항목', '이름 / 연락처', '개인정보는 이름과 연락처만 수집하며'],
    ['동의 철회 시 자료 처리 방법', '그때까지 수집된 자료는 즉시 폐기합니다.', '참여자가 동의를 철회하면 그때까지 수집된 자료는 즉시 폐기합니다'],
  ])('문항 주제에 대한 입력 문장에서 나온 답은 통과한다: %s', (q, a, e) => {
    expect(verifyAnswer(q, a, e, SRC).ok).toBe(true)
  })

  // 사용자 보고: "자연어로 한번에" 첫 줄에 제목을 썼는데 연구제목이 빈칸으로 나옴
  const TITLE = '작업기억 훈련이 실행기능에 미치는 영향'
  it.each([
    ['첫 줄에 제목만', `${TITLE}\n연구책임자는 김민수입니다.`],
    ['과제명은 …입니다', `과제명은 ${TITLE}입니다.\n연구책임자는 김민수입니다.`],
    ['본 연구는 …', `본 연구는 ${TITLE}에 관한 연구입니다.\n연구책임자는 김민수입니다.`],
    ['라벨 있음', `연구제목: ${TITLE}\n연구책임자는 김민수입니다.`],
  ])('연구제목은 입력에 라벨이 없어도 통과한다: %s', (_, src) => {
    for (const q of ['연구제목', '연구 제목', '연구과제명']) {
      expect(verifyAnswer(q, TITLE, src.split('\n')[0], src).ok).toBe(true)
    }
  })

  it('제목을 다른 문항(연구 목적)에 옮겨 쓰면 확인 권장으로 표시한다', () => {
    const src = `${TITLE}\n연구책임자는 김민수입니다.`
    expect(verifyAnswer('연구 목적', TITLE, TITLE, src)).toMatchObject({ ok: true, warning: 'off-topic' })
    expect(verifyAnswer('연구 배경 설명', TITLE, TITLE, src)).toMatchObject({ ok: true, warning: 'off-topic' })
  })
})

describe('verifyAnswer (사용자 보고: 양식 용어 없이 쓴 입력)', () => {
  // "연구기간", "선정기준" 같은 양식 용어를 쓰지 않은 실제 입력 → 예전에는 off-topic 으로 모두 막혔다
  const SRC = `본 연구는 IRB 승인 후 6개월간 진행한다.
만 19세 이상 39세 이하의 건강한 성인을 모집한다.
참여자는 8주 동안 매주 2회 작업기억 과제를 수행한다.`

  it.each([
    ['연구기간', 'IRB 승인 후 6개월간', '본 연구는 IRB 승인 후 6개월간 진행한다'],
    ['연구대상자 선정기준', '만 19세 이상 39세 이하의 건강한 성인', '만 19세 이상 39세 이하의 건강한 성인을 모집한다'],
    ['연구절차', '참여자는 8주 동안 매주 2회 작업기억 과제를 수행한다.', '참여자는 8주 동안 매주 2회 작업기억 과제를 수행한다'],
  ])('입력에서 나온 답은 막지 않는다: %s', (q, a, e) => {
    expect(verifyAnswer(q, a, e, SRC).ok).toBe(true)
  })

  it('지어낸 내용은 여전히 막는다', () => {
    expect(verifyAnswer('예상 연구대상자 수', '30명', '만 19세 이상 39세 이하의 건강한 성인을 모집한다', SRC))
      .toMatchObject({ ok: false, reason: 'number-not-in-input' })
    expect(verifyAnswer('탈락 기준', '과제를 세 번 이상 수행하지 못하면 탈락 처리한다', '참여자는 8주 동안 매주 2회 작업기억 과제를 수행한다', SRC).ok)
      .toBe(false)
    expect(verifyAnswer('사례비 등 제공 항목 및 금액', '참여자에게 소정의 사례비를 지급한다', '참여자는 8주 동안', SRC).ok).toBe(false)
  })
})

describe('quoteCoverage', () => {
  it('글자 그대로면 1, 전혀 다르면 낮다', () => {
    const src = normalizeForMatch(SOURCE)
    expect(quoteCoverage('한국대학교 심리학과', src)).toBe(1)
    expect(quoteCoverage('연구 종료 후 전자적 파일 삭제 및 종이자료 파쇄', src)).toBeLessThan(0.5)
  })
})
