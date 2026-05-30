import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ChangeLog } from './change-log'
import { createWriteTool, type WriteToolContext } from './write-tool'

const okOptions = { toolCallId: 't1', messages: [] } as never

function makeCtx(over: Partial<WriteToolContext> = {}): WriteToolContext {
  return {
    shell: async () => ({ code: 0, stdout: '', stderr: '' }),
    changeLog: new ChangeLog(),
    ...over
  }
}

const spec = {
  description: '示例可逆写',
  inputSchema: z.object({ value: z.string() }),
  riskLevel: 'reversible' as const,
  describe: (i: { value: string }) => `设为 ${i.value}`,
  snapshot: async () => ({ prev: 'old' }),
  apply: async (i: { value: string }) => `已设为 ${i.value}`,
  rollback: async () => {}
}

describe('createWriteTool', () => {
  it('可逆写：快照→应用→记账，结果为 apply 返回值', async () => {
    const ctx = makeCtx()
    const t = createWriteTool(spec, ctx)
    const out = await t.execute!({ value: 'X' }, okOptions)
    expect(out).toBe('已设为 X')
    expect(ctx.changeLog.list()).toEqual([{ id: 1, description: '设为 X', riskLevel: 'reversible' }])
  })

  it('记账的 rollback 真正调用 spec.rollback', async () => {
    let rolledBack = false
    const ctx = makeCtx()
    const t = createWriteTool({ ...spec, rollback: async () => void (rolledBack = true) }, ctx)
    await t.execute!({ value: 'X' }, okOptions)
    await ctx.changeLog.rollbackAll()
    expect(rolledBack).toBe(true)
  })

  it('不可逆写且无 confirm：拒绝执行，不记账', async () => {
    const ctx = makeCtx()
    const t = createWriteTool({ ...spec, riskLevel: 'irreversible' }, ctx)
    const out = (await t.execute!({ value: 'X' }, okOptions)) as string
    expect(out).toMatch(/拒绝|未获授权/)
    expect(ctx.changeLog.list()).toEqual([])
  })

  it('不可逆写且 confirm 返回 true：执行并记账', async () => {
    const ctx = makeCtx({ confirm: async () => true })
    const t = createWriteTool({ ...spec, riskLevel: 'irreversible' }, ctx)
    await t.execute!({ value: 'X' }, okOptions)
    expect(ctx.changeLog.list()).toHaveLength(1)
  })
})
