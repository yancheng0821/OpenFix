import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      runAgent: (
        messages: { role: 'user' | 'assistant'; content: string }[]
      ) => Promise<{
        text: string
        toolCalls: { toolName: string; input: unknown }[]
        changes: { id: number; description: string; riskLevel: 'reversible' | 'irreversible' }[]
        rolledBack: boolean
      }>
      rollback: () => Promise<{ ok: boolean }>
    }
  }
}
