import { useRef, useState } from 'react'
import type { AgentEvent, ModelMessage } from '@openfix/core'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** 仅用于界面：这条 assistant 回复背后跑过的步骤（折叠展示）。不发给模型。 */
  steps?: RunStep[]
}

export interface ChangeSummary {
  id: number
  description: string
  riskLevel: 'reversible' | 'irreversible'
}

export type RunPhase = 'idle' | 'thinking' | 'investigating' | 'working' | 'fixing' | 'verifying'

export interface RunStep {
  id: string
  tool: string
  status: 'running' | 'done'
  output?: unknown
  at: string
}

export interface RunState {
  phase: RunPhase
  steps: RunStep[]
  streamingText: string
}

export const initialRun: RunState = { phase: 'idle', steps: [], streamingText: '' }

function hhmm(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 纯函数：把一个 AgentEvent 折叠进运行态（可独立单测）。 */
export function reduceEvent(state: RunState, ev: AgentEvent): RunState {
  switch (ev.type) {
    case 'phase':
      return { ...state, phase: ev.phase }
    case 'step':
      return {
        ...state,
        steps: [...state.steps, { id: ev.id, tool: ev.tool, status: 'running', at: hhmm() }]
      }
    case 'step-done':
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.id === ev.id ? { ...s, status: 'done', output: ev.output } : s
        )
      }
    case 'text':
      return { ...state, streamingText: state.streamingText + ev.delta }
    default:
      return state
  }
}

export interface UseAgentRun {
  messages: ChatMessage[]
  run: RunState
  running: boolean
  changes: ChangeSummary[]
  reverted: boolean
  send: (text: string) => Promise<void>
  rollback: () => Promise<void>
  reset: () => void
}

/** 对话 + 流式运行的状态机：消费 onEvent 实时更新，结束落地消息与可还原改动。 */
export function useAgentRun(): UseAgentRun {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [run, setRun] = useState<RunState>(initialRun)
  const [running, setRunning] = useState(false)
  const [changes, setChanges] = useState<ChangeSummary[]>([])
  const [reverted, setReverted] = useState(false)
  // 完整对话轨迹（含工具调用/结果），按轮回灌给模型——多轮上下文靠它，不靠提示词
  const modelMessages = useRef<ModelMessage[]>([])

  async function send(text: string): Promise<void> {
    const t = text.trim()
    if (!t || running) return
    setMessages((prev) => [...prev, { role: 'user', content: t }]) // 仅显示
    setRunning(true)
    setReverted(false)
    setChanges([])
    let live: RunState = { phase: 'thinking', steps: [], streamingText: '' }
    setRun(live)
    try {
      const input: ModelMessage[] = [...modelMessages.current, { role: 'user', content: t }]
      const res = await window.api.runAgent(input, (ev) => {
        live = reduceEvent(live, ev)
        setRun(live)
      })
      modelMessages.current = res.messages // 串联本轮完整轨迹，供下一轮
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.text, steps: live.steps }
      ])
      // res.changes 已是"保留下来"的改动（propose_fix 等）；自动型回滚的不在其中
      const rev = res.changes.filter((c) => c.riskLevel === 'reversible')
      if (rev.length) setChanges(rev)
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `出错了：${(e as Error).message}` }
      ])
    } finally {
      setRun(initialRun)
      setRunning(false)
    }
  }

  async function rollback(): Promise<void> {
    const r = await window.api.rollback()
    if (r.ok) {
      setReverted(true)
      setChanges([])
    }
  }

  /** 新开对话：清空全部会话态（含完整轨迹），回到欢迎页。运行中不动。 */
  function reset(): void {
    if (running) return
    modelMessages.current = []
    setMessages([])
    setChanges([])
    setReverted(false)
    setRun(initialRun)
  }

  return { messages, run, running, changes, reverted, send, rollback, reset }
}
