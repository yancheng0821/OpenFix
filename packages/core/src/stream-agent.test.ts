import { describe, it, expect } from 'vitest'
import { MockLanguageModelV2 } from 'ai/test'
import { simulateReadableStream, tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { streamAgent, phaseForTool, stripThink } from './stream-agent'
import type { AgentEvent } from './run-shared'

describe('stripThink', () => {
  it('删除完整 think 段，保留正文', () => {
    expect(stripThink('<think>盘算一下</think>答案是通的')).toBe('答案是通的')
    expect(stripThink('前<think>x</think>中<thinking>y</thinking>后')).toBe('前中后')
  })
  it('未闭合的 think（还在生成）整段砍掉', () => {
    expect(stripThink('正文<think>正在想')).toBe('正文')
  })
  it('结尾半个标签也砍掉，等下个 delta 补全', () => {
    expect(stripThink('正文<')).toBe('正文')
    expect(stripThink('正文<thi')).toBe('正文')
  })
  it('无 think 文本原样返回', () => {
    expect(stripThink('就是普通回答')).toBe('就是普通回答')
  })
  it('累计调用取增量：去 think 后单调增长', () => {
    let emitted = ''
    let raw = ''
    for (const d of ['<think>', '想', '</think>', '答', '案']) {
      raw += d
      const clean = stripThink(raw)
      emitted += clean.slice(emitted.length)
    }
    expect(emitted).toBe('答案')
  })
})

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
