import { describe, it, expect } from 'vitest'
import { MockLanguageModelV2 } from 'ai/test'
import { simulateReadableStream, tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { streamAgent, phaseForTool } from './stream-agent'
import type { AgentEvent } from './run-shared'

describe('phaseForTool', () => {
  it('remember 归到 thinking（记笔记不显示"修复"）', () => {
    expect(phaseForTool('remember')).toBe('thinking')
  })
  it('诊断/打开/复测/写各归其位', () => {
    expect(phaseForTool('run_diagnostic')).toBe('investigating')
    expect(phaseForTool('open_app')).toBe('working')
    expect(phaseForTool('verify_connectivity')).toBe('verifying')
    expect(phaseForTool('set_dns_servers')).toBe('fixing')
  })
})

describe('streamAgent', () => {
  it('流式发出 step 与 text 事件，最终 done 带等价 AgentResult', async () => {
    let call = 0
    const model = new MockLanguageModelV2({
      doStream: async () => {
        call += 1
        if (call === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                {
                  type: 'tool-call',
                  toolCallId: 'c1',
                  toolName: 'check_connectivity',
                  input: JSON.stringify({ host: '8.8.8.8' })
                },
                {
                  type: 'finish',
                  finishReason: 'tool-calls',
                  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
                }
              ]
            })
          }
        }
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: '是通的' },
              { type: 'text-end', id: 't1' },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
              }
            ]
          })
        }
      }
    })
    const tools: ToolSet = {
      check_connectivity: tool({
        description: '测连通',
        inputSchema: z.object({ host: z.string() }),
        execute: async () => ({ reachable: true })
      })
    }

    const events: AgentEvent[] = []
    const result = await streamAgent('我连不上网', { model, tools, onEvent: (e) => events.push(e) })

    expect(events.some((e) => e.type === 'step' && e.tool === 'check_connectivity')).toBe(true)
    expect(events.some((e) => e.type === 'step-done')).toBe(true)
    expect(
      events
        .filter((e) => e.type === 'text')
        .map((e) => (e as { delta: string }).delta)
        .join('')
    ).toContain('是通的')
    expect(events.at(-1)?.type).toBe('done')
    expect(result.text).toContain('是通的')
    expect(result.toolCalls.map((c) => c.toolName)).toContain('check_connectivity')
  })
})
