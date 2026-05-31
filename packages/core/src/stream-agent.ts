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
import type { AgentPhase } from './run-shared.js'

export interface StreamDeps extends RunDeps {
  onEvent: (event: AgentEvent) => void
}

/** 把工具映射到"它当下在做什么"，让界面状态贴合实际（不是一律"排查"）。 */
export function phaseForTool(tool: string): AgentPhase {
  if (tool.startsWith('verify')) return 'verifying'
  if (tool === 'remember') return 'thinking'
  if (tool === 'open_app' || tool === 'open_url') return 'working'
  if (
    tool === 'run_diagnostic' ||
    tool.startsWith('check_') ||
    tool.startsWith('get_') ||
    tool.startsWith('resolve_')
  )
    return 'investigating'
  return 'fixing'
}

const THINK_BLOCK = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi
const THINK_OPEN = /<think(?:ing)?>/i
const TAG_PREFIXES = ['<think>', '</think>', '<thinking>', '</thinking>']

/**
 * 去掉推理模型（如 MiniMax）夹在正文里的思维链 `<think>…</think>`。
 * - 完整 think 段整段删除；
 * - 未闭合的 think（还在生成）连同其后内容暂时砍掉；
 * - 结尾若是半个标签（如 `<thi`）也砍掉，等下个 delta 补全。
 * 对不含 think 的文本无副作用。可对"累计原文"反复调用、再取增量发送。
 */
export function stripThink(raw: string): string {
  let s = raw.replace(THINK_BLOCK, '')
  const open = s.search(THINK_OPEN)
  if (open !== -1) s = s.slice(0, open)
  for (let cut = Math.min(s.length, 11); cut >= 1; cut--) {
    const tail = s.slice(-cut)
    if (TAG_PREFIXES.some((t) => t.startsWith(tail))) {
      s = s.slice(0, -cut)
      break
    }
  }
  return s
}

/** 流式版 agent：边跑边通过 onEvent 推 step/text/change/verify 事件，结束 done。 */
export async function streamAgent(
  input: string | ChatMessage[],
  deps: StreamDeps
): Promise<AgentResult> {
  const { model, tools, system, changeLog, verification } = assembleRun(deps)
  const { onEvent } = deps

  // 默认中性"思考"——纯对话/回答时不该显示"正在排查"
  onEvent({ type: 'phase', phase: 'thinking' })

  const result = streamText({
    model,
    tools,
    system,
    ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
    stopWhen: stepCountIs(16)
  })

  let emittedChanges = 0
  // 过滤思维链：累计原文，每次只发"去掉 think 后"的增量
  let rawText = ''
  let emittedLen = 0
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
        onEvent({ type: 'phase', phase: phaseForTool(p.toolName) })
        onEvent({ type: 'step', id: p.toolCallId ?? p.toolName, tool: p.toolName })
      } else if (p.type === 'tool-result') {
        onEvent({ type: 'step-done', id: p.toolCallId ?? '', output: p.output ?? p.result })
      } else if (p.type === 'text-delta') {
        const delta = p.text ?? p.delta ?? ''
        if (delta) {
          rawText += delta
          const clean = stripThink(rawText)
          const add = clean.slice(emittedLen)
          if (add) {
            onEvent({ type: 'text', delta: add })
            emittedLen = clean.length
          }
        }
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
  const streamedText = stripThink(await result.text)
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
