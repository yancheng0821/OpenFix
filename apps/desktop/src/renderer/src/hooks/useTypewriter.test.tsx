import { describe, it, expect } from 'vitest'
import { advance } from './useTypewriter'

describe('advance', () => {
  it('从空开始小步推进（最小步进 2）', () => {
    expect(advance('', 'abcdefghij')).toBe('ab') // step = max(2, ceil(10/8)=2) = 2
  })
  it('差距大走得快（约 1/8）', () => {
    const t = 'x'.repeat(80)
    expect(advance('', t).length).toBe(10) // ceil(80/8) = 10
  })
  it('接近目标时一步到位', () => {
    expect(advance('abcde', 'abcdef')).toBe('abcdef')
  })
  it('已显示达到/超过目标（含重置）→ 直接给目标', () => {
    expect(advance('abcdef', 'abcdef')).toBe('abcdef')
    expect(advance('oldlong', '')).toBe('')
  })
})
