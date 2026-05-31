import 'dotenv/config'
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { streamAgent, ChangeLog, type AgentEvent } from '@openfix/core'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    backgroundColor: '#00000000',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // macOS：开发期把 Dock 图标设为真实 logo
  if (process.platform === 'darwin') app.dock?.setIcon(icon)

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // OpenFix：main 进程持有"最近一次运行"的还原句柄（rollback 是闭包，不能跨 IPC 序列化）
  let currentRollback: (() => Promise<void>) | null = null
  // 不可逆/通用写操作的确认请求：main 发请求给渲染层、等用户回应
  const pendingConfirms = new Map<number, (ok: boolean) => void>()
  let confirmSeq = 0

  ipcMain.handle(
    'agent:run',
    async (event, messages: { role: 'user' | 'assistant'; content: string }[]) => {
      const changeLog = new ChangeLog()
      const result = await streamAgent(messages, {
        changeLog,
        onEvent: (ev: AgentEvent) => event.sender.send('agent:event', ev),
        confirm: (description: string) =>
          new Promise<boolean>((resolve) => {
            const id = ++confirmSeq
            pendingConfirms.set(id, resolve)
            event.sender.send('agent:confirm', { id, description })
          })
      })
      // 成功且有"可逆"改动 → 留还原句柄；失败(已自动还原)或无可逆改动 → 清空
      const hasReversible = result.changes.some((c) => c.riskLevel === 'reversible')
      currentRollback =
        !result.rolledBack && hasReversible ? () => changeLog.rollbackReversible() : null
      return result
    }
  )

  ipcMain.handle('agent:confirm:response', (_e, id: number, ok: boolean) => {
    const resolve = pendingConfirms.get(id)
    if (resolve) {
      resolve(ok)
      pendingConfirms.delete(id)
    }
    return { ok: true }
  })

  ipcMain.handle('agent:rollback', async () => {
    if (!currentRollback) return { ok: false }
    await currentRollback()
    currentRollback = null
    return { ok: true }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
