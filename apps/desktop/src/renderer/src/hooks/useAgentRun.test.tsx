import { describe, it, expect } from 'vitest'
import { reduceEvent, initialRun } from './useAgentRun'

describe('reduceEvent', () => {
  it('step 加 running 步骤、step-done 标记完成并带 output', () => {
    let s = initialRun
    s = reduceEvent(s, { type: 'step', id: 'c1', tool: 'check_connectivity' })
    expect(s.steps[0]).toMatchObject({ id: 'c1', tool: 'check_connectivity', status: 'running' })
    s = reduceEvent(s, { type: 'step-done', id: 'c1', output: { reachable: true } })
    expect(s.steps[0].status).toBe('done')
    expect(s.steps[0].output).toEqual({ reachable: true })
  })

  it('text 累加、phase 更新', () => {
    let s = initialRun
    s = reduceEvent(s, { type: 'phase', phase: 'fixing' })
    s = reduceEvent(s, { type: 'text', delta: '你' })
    s = reduceEvent(s, { type: 'text', delta: '好' })
    expect(s.phase).toBe('fixing')
    expect(s.streamingText).toBe('你好')
  })
})
