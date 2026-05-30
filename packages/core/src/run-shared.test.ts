import { describe, it, expect } from 'vitest'
import { MockLanguageModelV2 } from 'ai/test'
import { assembleRun, finalizeRun, concludeIfNeeded } from './run-shared'
import { ChangeLog } from './safety/change-log'
import { Verification } from './safety/verification'

describe('assembleRun', () => {
  it('默认装配出网络+系统工具与系统提示', () => {
    const a = assembleRun({
      model: {} as never,
      shell: async () => ({ code: 0, stdout: '', stderr: '' })
    })
    expect(Object.keys(a.tools)).toContain('run_diagnostic')
    expect(Object.keys(a.tools)).toContain('set_dns_servers')
    expect(Object.keys(a.tools)).toContain('empty_trash')
    expect(a.system).toMatch(/OpenFix/)
  })

  it('注入 tools 时直接用注入的工具', () => {
    const a = assembleRun({ model: {} as never, tools: { foo: {} as never } })
    expect(Object.keys(a.tools)).toEqual(['foo'])
  })
})

describe('finalizeRun', () => {
  it('有可逆改动但复测未过 → 回滚 + rolledBack + 文案', async () => {
    const changeLog = new ChangeLog()
    let rolled = false
    changeLog.record({
      description: '改了X',
      riskLevel: 'reversible',
      rollback: async () => void (rolled = true)
    })
    const verification = new Verification()
    const r = await finalizeRun(changeLog, verification, '试着修了')
    expect(rolled).toBe(true)
    expect(r.rolledBack).toBe(true)
    expect(r.text).toMatch(/还原/)
  })

  it('不可逆改动不参与回滚', async () => {
    const changeLog = new ChangeLog()
    changeLog.record({ description: '清空废纸篓', riskLevel: 'irreversible', rollback: async () => {} })
    const verification = new Verification()
    const r = await finalizeRun(changeLog, verification, '清了')
    expect(r.rolledBack).toBe(false)
    expect(r.changes).toHaveLength(1)
  })
})

describe('concludeIfNeeded', () => {
  it('已有文本：原样返回，不调模型', async () => {
    const out = await concludeIfNeeded({} as never, 'sys', [], '已有结论')
    expect(out).toBe('已有结论')
  })

  it('文本为空：用模型补一段结论', async () => {
    const model = new MockLanguageModelV2({
      doGenerate: async () => ({
        finishReason: 'stop' as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: 'text' as const, text: '补的结论' }],
        warnings: []
      })
    })
    const out = await concludeIfNeeded(model, 'sys', [], '   ')
    expect(out).toBe('补的结论')
  })
})
