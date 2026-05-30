import { describe, it, expect } from 'vitest'
import { Verification } from './verification'

describe('Verification', () => {
  it('初始未复测：passed=null, attempted=false', () => {
    const v = new Verification()
    expect(v.passed).toBeNull()
    expect(v.attempted).toBe(false)
  })

  it('record(true) 后 passed=true、attempted=true', () => {
    const v = new Verification()
    v.record(true)
    expect(v.passed).toBe(true)
    expect(v.attempted).toBe(true)
  })

  it('record(false) 后 passed=false', () => {
    const v = new Verification()
    v.record(false)
    expect(v.passed).toBe(false)
  })
})
