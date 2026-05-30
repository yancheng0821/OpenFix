import { streamText, stepCountIs, type ModelMessage } from 'ai'
import {
  assembleRun,
  finalizeRun,
  concludeIfNeeded,
  type RunDeps,
  type AgentResult,
  type AgentEvent
} from './run-shared.js'
import type { ChatMessage } from './run-agent.js'

export interface StreamDeps extends RunDeps {
  onEvent: (event: AgentEvent) => void
}

/** 流式版 agent：边跑边通过 onEvent 推 step/text/change/verify 事件，结束 done。 */
export async function streamAgent(
  input: string | ChatMessage[],
  deps: StreamDeps
): Promise<AgentResult> {
  const { model, tools, system, changeLog, verification } = assembleRun(deps)
  const { onEvent } = deps

  onEvent({ type: 'phase', phase: 'investigating' })

  const result = streamText({
    model,
    tools,
    system,
    ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
    stopWhen: stepCountIs(16)
  })

  let emittedChanges = 0
  try {
    for await (const part of result.fullStream) {
      const p = part as {
        type: string
        toolName?: string
        toolCallId?: string
        text?: string
        delta?: string
        output?: unknown
        result?: unknown
        error?: unknown
      }
      if (p.type === 'tool-call' && p.toolName) {
        if (p.toolName.startsWith('verify')) onEvent({ type: 'phase', phase: 'verifying' })
        onEvent({ type: 'step', id: p.toolCallId ?? p.toolName, tool: p.toolName })
      } else if (p.type === 'tool-result') {
        onEvent({ type: 'step-done', id: p.toolCallId ?? '', output: p.output ?? p.result })
      } else if (p.type === 'text-delta') {
        const delta = p.text ?? p.delta ?? ''
        if (delta) onEvent({ type: 'text', delta })
      } else if (p.type === 'error') {
        onEvent({ type: 'error', message: String(p.error) })
      }
      // 账本增长 → 发 change 事件（写操作发生）
      const list = changeLog.list()
      if (list.length > emittedChanges) {
        onEvent({ type: 'phase', phase: 'fixing' })
        for (let i = emittedChanges; i < list.length; i++) {
          onEvent({ type: 'change', change: list[i] })
        }
        emittedChanges = list.length
      }
    }
  } catch (e) {
    onEvent({ type: 'error', message: (e as Error).message })
  }

  if (verification.attempted) onEvent({ type: 'verify', passed: verification.passed === true })

  const steps = await result.steps
  const toolCalls = steps
    .flatMap((s) => s.toolCalls)
    .map((c) => ({ toolName: c.toolName, input: c.input }))
  const streamedText = await result.text
  const response = await result.response
  const original: ModelMessage[] =
    typeof input === 'string' ? [{ role: 'user', content: input }] : (input as ModelMessage[])
  let finalText = streamedText
  if (!streamedText.trim()) {
    finalText = await concludeIfNeeded(
      model,
      system,
      [...original, ...(response.messages as ModelMessage[])],
      streamedText
    )
    if (finalText) onEvent({ type: 'text', delta: finalText })
  }
  const fin = await finalizeRun(changeLog, verification, finalText)
  const agentResult: AgentResult = {
    text: fin.text,
    toolCalls,
    changes: fin.changes,
    rolledBack: fin.rolledBack
  }
  onEvent({ type: 'done', result: agentResult })
  return agentResult
}
