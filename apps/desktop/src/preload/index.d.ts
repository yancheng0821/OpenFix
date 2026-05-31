import { ElectronAPI } from '@electron-toolkit/preload'
import type { AgentEvent, ModelMessage } from '@openfix/core'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      runAgent: (
        messages: ModelMessage[],
        onEvent?: (event: AgentEvent) => void
      ) => Promise<{
        text: string
        toolCalls: { toolName: string; input: unknown }[]
        changes: { id: number; description: string; riskLevel: 'reversible' | 'irreversible' }[]
        rolledBack: boolean
        messages: ModelMessage[]
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
      openMemoryFile: () => Promise<{ ok: boolean }>
      onMenuSettings: (cb: () => void) => () => void
    }
  }
}
