import { generateText, stepCountIs, type ModelMessage } from 'ai'
import {
  assembleRun,
  finalizeRun,
  concludeIfNeeded,
  type RunDeps,
  type AgentResult
} from './run-shared.js'

export type { AgentResult } from './run-shared.js'
export type { RunDeps as RunAgentDeps } from './run-shared.js'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * 薄 agent loop（阻塞式，一次性返回）。流式版见 streamAgent。
 * input 传字符串=单轮；传 ModelMessage[]=带完整轨迹的多轮对话。
 */
export async function runAgent(
  input: string | ModelMessage[],
  deps: RunDeps = {}
): Promise<AgentResult> {
  const { model, tools, system, changeLog, verification } = assembleRun(deps)

  const result = await generateText({
    model,
    tools,
    system,
    ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
    stopWhen: stepCountIs(16)
  })

  const toolCalls = result.steps
    .flatMap((s) => s.toolCalls)
    .map((c) => ({ toolName: c.toolName, input: c.input }))
  const original: ModelMessage[] =
    typeof input === 'string' ? [{ role: 'user', content: input }] : (input as ModelMessage[])
  const text = await concludeIfNeeded(
    model,
    system,
    [...original, ...(result.response.messages as ModelMessage[])],
    result.text
  )
  const fin = await finalizeRun(changeLog, verification, text)
  let messages: ModelMessage[] = [...original, ...(result.response.messages as ModelMessage[])]
  if (!result.text.trim() && text.trim()) {
    messages = [...messages, { role: 'assistant', content: text }]
  }
  return { text: fin.text, toolCalls, changes: fin.changes, rolledBack: fin.rolledBack, messages }
}
