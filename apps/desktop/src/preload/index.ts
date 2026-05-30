import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AgentEvent } from '@openfix/core'

type RunResult = {
  text: string
  toolCalls: { toolName: string; input: unknown }[]
  changes: { id: number; description: string; riskLevel: 'reversible' | 'irreversible' }[]
  rolledBack: boolean
}

// Custom APIs for renderer
const api = {
  runAgent: (
    messages: { role: 'user' | 'assistant'; content: string }[],
    onEvent?: (event: AgentEvent) => void
  ): Promise<RunResult> => {
    if (!onEvent) return ipcRenderer.invoke('agent:run', messages)
    const listener = (_e: IpcRendererEvent, ev: AgentEvent): void => onEvent(ev)
    ipcRenderer.on('agent:event', listener)
    return (ipcRenderer.invoke('agent:run', messages) as Promise<RunResult>).finally(() =>
      ipcRenderer.removeListener('agent:event', listener)
    )
  },
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
