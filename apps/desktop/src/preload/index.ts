import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  runAgent: (
    messages: { role: 'user' | 'assistant'; content: string }[]
  ): Promise<{
    text: string
    toolCalls: { toolName: string; input: unknown }[]
    changes: { id: number; description: string; riskLevel: 'reversible' | 'irreversible' }[]
    rolledBack: boolean
  }> => ipcRenderer.invoke('agent:run', messages),
  rollback: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('agent:rollback')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
