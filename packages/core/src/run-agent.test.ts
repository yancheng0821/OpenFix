import { describe, it, expect } from 'vitest'
import { MockLanguageModelV2 } from 'ai/test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { runAgent } from './run-agent'

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
})
