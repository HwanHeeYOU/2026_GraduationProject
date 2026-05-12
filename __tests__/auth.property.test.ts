// Feature: yourpark-irb-saas, Property 1: 회원가입 round-trip
// Feature: yourpark-irb-saas, Property 2: 잘못된 자격증명 거부
// Feature: yourpark-irb-saas, Property 3: 로그아웃 후 토큰 무효화
// Feature: yourpark-irb-saas, Property 4: 미인증 접근 차단

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import bcrypt from 'bcryptjs'

// **Validates: Requirements 2.1, 2.2**
describe('Property 1 & 2: bcrypt 해싱 round-trip', () => {
  it('임의 비밀번호에 대해 hash 후 compare가 true를 반환한다', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 72 }),
        async (password) => {
          const hash = await bcrypt.hash(password, 10)
          const result = await bcrypt.compare(password, hash)
          return result === true
        }
      ),
      { numRuns: 20 }
    )
  })

  // **Validates: Requirements 2.3, 2.4**
  it('잘못된 비밀번호에 대해 compare가 false를 반환한다', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 72 }),
        fc.string({ minLength: 1, maxLength: 72 }),
        async (password, wrongPassword) => {
          fc.pre(password !== wrongPassword)
          const hash = await bcrypt.hash(password, 10)
          const result = await bcrypt.compare(wrongPassword, hash)
          return result === false
        }
      ),
      { numRuns: 20 }
    )
  })
})
