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
})
