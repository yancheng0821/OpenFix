import { describe, it, expect } from 'vitest'
import { reduceEvent, initialRun } from './useAgentRun'

describe('reduceEvent', () => {
  it('step 累加工具、text 累加文字、phase 更新', () => {
    let s = initialRun
    s = reduceEvent(s, { type: 'phase', phase: 'investigating' })
    s = reduceEvent(s, { type: 'step', tool: 'check_connectivity' })
    s = reduceEvent(s, { type: 'text', delta: '你' })
    s = reduceEvent(s, { type: 'text', delta: '好' })
    s = reduceEvent(s, { type: 'phase', phase: 'fixing' })
    expect(s.phase).toBe('fixing')
    expect(s.steps).toEqual(['check_connectivity'])
    expect(s.streamingText).toBe('你好')
  })
})
