import { useState } from 'react'
import type { AgentEvent } from '@openfix/core'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChangeSummary {
  id: number
  description: string
  riskLevel: 'reversible' | 'irreversible'
}

export type RunPhase = 'idle' | 'investigating' | 'fixing' | 'verifying'

export interface RunState {
  phase: RunPhase
  steps: string[]
  streamingText: string
}

export const initialRun: RunState = { phase: 'idle', steps: [], streamingText: '' }

/** 纯函数：把一个 AgentEvent 折叠进运行态（可独立单测）。 */
export function reduceEvent(state: RunState, ev: AgentEvent): RunState {
  switch (ev.type) {
    case 'phase':
      return { ...state, phase: ev.phase }
    case 'step':
      return { ...state, steps: [...state.steps, ev.tool] }
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
}

/** 对话 + 流式运行的状态机：消费 onEvent 实时更新，结束落地消息与可还原改动。 */
export function useAgentRun(): UseAgentRun {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [run, setRun] = useState<RunState>(initialRun)
  const [running, setRunning] = useState(false)
  const [changes, setChanges] = useState<ChangeSummary[]>([])
  const [reverted, setReverted] = useState(false)

  async function send(text: string): Promise<void> {
    const t = text.trim()
    if (!t || running) return
    const history: ChatMessage[] = [...messages, { role: 'user', content: t }]
    setMessages(history)
    setRunning(true)
    setReverted(false)
    setChanges([])
    let live: RunState = { phase: 'investigating', steps: [], streamingText: '' }
    setRun(live)
    try {
      const res = await window.api.runAgent(history, (ev) => {
        live = reduceEvent(live, ev)
        setRun(live)
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: res.text }])
      if (!res.rolledBack) {
        const rev = res.changes.filter((c) => c.riskLevel === 'reversible')
        if (rev.length) setChanges(rev)
      }
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

  return { messages, run, running, changes, reverted, send, rollback }
}
