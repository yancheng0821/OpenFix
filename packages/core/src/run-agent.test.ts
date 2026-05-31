import { describe, it, expect } from 'vitest'
import { MockLanguageModelV2 } from 'ai/test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { runAgent } from './run-agent'
import { ChangeLog } from './safety/change-log'
import type { SkillPack } from './skills/skill-pack'

// —— 2b 辅助：可配置复测结果的 mock shell（reachableCode=0 表示能上网；networksetup 恒成功）——
function mkShell(reachableCode: number): {
  shell: (c: string, a: string[]) => Promise<{ code: number; stdout: string; stderr: string }>
  calls: string[]
} {
  const ok = reachableCode === 0
  const calls: string[] = []
  const shell = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args].join(' '))
    // verify_connectivity 现在用 curl 真探测：返回 http_code
    if (cmd === 'curl') return { code: ok ? 0 : 7, stdout: ok ? '200' : '000', stderr: '' }
    if (args.includes('-getdnsservers'))
      return { code: 0, stdout: "There aren't any DNS Servers set on Wi-Fi.", stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { shell, calls }
}

// —— 2b 辅助：按脚本逐步返回的 mock 模型 ——
function scripted(steps: Array<{ tool?: { name: string; input: object }; text?: string }>): MockLanguageModelV2 {
  let i = 0
  return new MockLanguageModelV2({
    doGenerate: async () => {
      const step = steps[Math.min(i, steps.length - 1)]
      i += 1
      if (step.tool) {
        return {
          finishReason: 'tool-calls' as const,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: `c${i}`,
              toolName: step.tool.name,
              input: JSON.stringify(step.tool.input)
            }
          ],
          warnings: []
        }
      }
      return {
        finishReason: 'stop' as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: 'text' as const, text: step.text ?? '好了。' }],
        warnings: []
      }
    }
  })
}

describe('runAgent', () => {
  it('先调工具、再把结论用文字返回', async () => {
    // mock 模型：第 1 次返回工具调用，第 2 次返回文字结论
    let call = 0
    const model = new MockLanguageModelV2({
      doGenerate: async () => {
        call += 1
        if (call === 1) {
          return {
            finishReason: 'tool-calls' as const,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: 'call-1',
                toolName: 'check_connectivity',
                input: JSON.stringify({ host: '8.8.8.8' })
              }
            ],
            warnings: []
          }
        }
        return {
          finishReason: 'stop' as const,
          usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          content: [{ type: 'text' as const, text: '你和 8.8.8.8 是通的，延迟约 12.3ms。' }],
          warnings: []
        }
      }
    })

    const executedHosts: string[] = []
    const tools: ToolSet = {
      check_connectivity: tool({
        description: '测试连通性',
        inputSchema: z.object({ host: z.string() }),
        execute: async ({ host }) => {
          executedHosts.push(host)
          return { host, reachable: true, latencyMs: 12.3 }
        }
      })
    }

    const result = await runAgent('我连不上网', { model, tools })

    expect(executedHosts).toEqual(['8.8.8.8'])
    expect(result.toolCalls).toEqual([
      { toolName: 'check_connectivity', input: { host: '8.8.8.8' } }
    ])
    expect(result.text).toContain('8.8.8.8')
  })

  it('接受对话历史（messages 数组）：三轮上下文都作为独立 messages 传给模型', async () => {
    let captured: Array<{ role: string }> = []
    const model = new MockLanguageModelV2({
      doGenerate: async (options) => {
        captured = options.prompt as Array<{ role: string }>
        return {
          finishReason: 'stop' as const,
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          content: [{ type: 'text' as const, text: '好的，我再帮你看一下。' }],
          warnings: []
        }
      }
    })

    const result = await runAgent(
      [
        { role: 'user', content: '我连不上网' },
        { role: 'assistant', content: '你和 8.8.8.8 是通的。' },
        { role: 'user', content: '那再测一次' }
      ],
      { model, tools: {} }
    )

    expect(result.text).toBe('好的，我再帮你看一下。')
    // 三轮对话都应作为 messages 传入：2 条 user + 1 条 assistant
    expect(captured.filter((m) => m.role === 'user')).toHaveLength(2)
    expect(captured.filter((m) => m.role === 'assistant')).toHaveLength(1)
  })

  it('调用写工具后，结果的 changes 记录该改动', async () => {
    let call = 0
    const model = new MockLanguageModelV2({
      doGenerate: async () => {
        call += 1
        if (call === 1) {
          return {
            finishReason: 'tool-calls' as const,
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: 'c1',
                toolName: 'set_dns_servers',
                input: JSON.stringify({ service: 'Wi-Fi', servers: ['1.1.1.1'] })
              }
            ],
            warnings: []
          }
        }
        return {
          finishReason: 'stop' as const,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          content: [{ type: 'text' as const, text: '已把 DNS 改好。' }],
          warnings: []
        }
      }
    })

    // 不注入 tools → 用默认工具集（含 set_dns_servers），但注入 mock shell 避免真实改动
    const result = await runAgent('帮我把 DNS 改成 1.1.1.1', {
      model,
      shell: async () => ({ code: 0, stdout: '', stderr: '' })
    })

    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({ riskLevel: 'reversible' })
    expect(result.changes[0].description).toMatch(/DNS/)
  })

  it('改动后复测通过：保留改动，rolledBack=false', async () => {
    const { shell } = mkShell(0) // ping 通
    const model = scripted([
      { tool: { name: 'set_dns_servers', input: { service: 'Wi-Fi', servers: ['1.1.1.1'] } } },
      { tool: { name: 'verify_connectivity', input: { host: '8.8.8.8' } } },
      { text: '已修好。' }
    ])
    const result = await runAgent('网连不上', { model, shell })
    expect(result.rolledBack).toBe(false)
    expect(result.changes).toHaveLength(1)
  })

  it('改动后复测失败：自动回滚，rolledBack=true 且文案含还原', async () => {
    const { shell, calls } = mkShell(2) // ping 不通
    const model = scripted([
      { tool: { name: 'set_dns_servers', input: { service: 'Wi-Fi', servers: ['1.1.1.1'] } } },
      { tool: { name: 'verify_connectivity', input: { host: '8.8.8.8' } } },
      { text: '试着改了 DNS。' }
    ])
    const result = await runAgent('网连不上', { model, shell })
    expect(result.rolledBack).toBe(true)
    expect(result.text).toMatch(/还原/)
    expect(calls).toContain('networksetup -setdnsservers Wi-Fi Empty')
  })

  it('改动后没复测：安全默认也回滚，rolledBack=true', async () => {
    const { shell } = mkShell(0)
    const model = scripted([
      { tool: { name: 'set_dns_servers', input: { service: 'Wi-Fi', servers: ['1.1.1.1'] } } },
      { text: '改完了（但没复测）。' }
    ])
    const result = await runAgent('网连不上', { model, shell })
    expect(result.rolledBack).toBe(true)
  })

  it('可注入 changeLog：成功修复后改动留在注入的账本里（供会话级还原）', async () => {
    const { shell } = mkShell(0) // 复测通过
    const model = scripted([
      { tool: { name: 'set_dns_servers', input: { service: 'Wi-Fi', servers: ['1.1.1.1'] } } },
      { tool: { name: 'verify_connectivity', input: { host: '8.8.8.8' } } },
      { text: '修好了。' }
    ])
    const changeLog = new ChangeLog()
    const result = await runAgent('网连不上', { model, shell, changeLog })
    expect(result.rolledBack).toBe(false)
    expect(changeLog.list()).toHaveLength(1) // 改动留在外部注入的账本
  })

  it('可注入 skillPacks：用包贡献的工具替代默认网络包', async () => {
    const executed: string[] = []
    const customPack: SkillPack = {
      name: 'demo',
      createTools: () => ({
        demo_tool: tool({
          description: 'demo',
          inputSchema: z.object({}),
          execute: async () => {
            executed.push('x')
            return 'done'
          }
        })
      })
    }
    const model = scripted([{ tool: { name: 'demo_tool', input: {} } }, { text: '完成' }])
    const result = await runAgent('做点什么', { model, skillPacks: [customPack] })
    expect(executed).toEqual(['x'])
    expect(result.toolCalls.map((c) => c.toolName)).toContain('demo_tool')
  })

  it('默认含通用 run_diagnostic：可跑只读命令（调到 df）', async () => {
    const calls: string[] = []
    const shell = async (cmd: string) => {
      calls.push(cmd)
      return { code: 0, stdout: '', stderr: '' }
    }
    const model = scripted([
      { tool: { name: 'run_diagnostic', input: { command: 'df', args: ['-h', '/'] } } },
      { text: '看了下磁盘。' }
    ])
    await runAgent('电脑有点卡', { model, shell })
    // run_diagnostic 在默认工具里、且白名单放行 df → 真调用 df
    expect(calls).toContain('df')
  })

  it('confirm 通过：不可逆工具执行、记一条 irreversible，且不被自动回滚', async () => {
    const calls: string[] = []
    const shell = async (cmd: string) => {
      calls.push(cmd)
      return { code: 0, stdout: '', stderr: '' }
    }
    const model = scripted([{ tool: { name: 'empty_trash', input: {} } }, { text: '已清空。' }])
    const result = await runAgent('帮我清下废纸篓', { model, shell, confirm: async () => true })
    expect(calls).toContain('osascript')
    expect(result.changes).toEqual([
      { id: 1, description: expect.stringMatching(/废纸篓/), riskLevel: 'irreversible' }
    ])
    expect(result.rolledBack).toBe(false)
  })

  it('confirm 缺省：不可逆工具被拒绝，不执行、无改动', async () => {
    const calls: string[] = []
    const shell = async (cmd: string) => {
      calls.push(cmd)
      return { code: 0, stdout: '', stderr: '' }
    }
    const model = scripted([{ tool: { name: 'empty_trash', input: {} } }, { text: '没清。' }])
    const result = await runAgent('帮我清下废纸篓', { model, shell })
    expect(calls).not.toContain('osascript')
    expect(result.changes).toEqual([])
    expect(result.rolledBack).toBe(false)
  })
})
