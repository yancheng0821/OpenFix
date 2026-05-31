import { ElectronAPI } from '@electron-toolkit/preload'
import type { AgentEvent } from '@openfix/core'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      runAgent: (
        messages: { role: 'user' | 'assistant'; content: string }[],
        onEvent?: (event: AgentEvent) => void
      ) => Promise<{
        text: string
        toolCalls: { toolName: string; input: unknown }[]
        changes: { id: number; description: string; riskLevel: 'reversible' | 'irreversible' }[]
        rolledBack: boolean
      }>
      rollback: () => Promise<{ ok: boolean }>
      onConfirm: (cb: (req: { id: number; description: string }) => void) => () => void
      respondConfirm: (id: number, ok: boolean) => Promise<{ ok: boolean }>
      getConfig: () => Promise<{
        cloud: { baseURL: string; apiKey: string; model: string }
        local: { baseURL: string; model: string }
      }>
      setConfig: (cfg: {
        cloud: { baseURL: string; apiKey: string; model: string }
        local: { baseURL: string; model: string }
      }) => Promise<{ ok: boolean }>
    }
  }
}
