import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      runAgent: (
        text: string
      ) => Promise<{ text: string; toolCalls: { toolName: string; input: unknown }[] }>
    }
  }
}
