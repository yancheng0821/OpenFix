import { z } from 'zod'
import type { ToolSet } from 'ai'
import { createWriteTool, type WriteToolContext } from '../safety/write-tool.js'

/** 软件/系统域修复工具：不可逆（需确认）+ 安全自恢复动作。 */
export function createSystemFixTools(ctx: WriteToolContext): ToolSet {
  return {
    empty_trash: createWriteTool(
      {
        description: '清空废纸篓以释放磁盘空间（不可逆，需用户确认）。',
        inputSchema: z.object({}),
        riskLevel: 'irreversible',
        describe: () => '清空废纸篓（不可撤销）',
        apply: async (_input, shell) => {
          await shell('osascript', ['-e', 'tell application "Finder" to empty trash'])
          return '已清空废纸篓。'
        }
      },
      ctx
    ),

    kill_process: createWriteTool(
      {
        description: '结束一个卡死或占用资源过高的进程（需用户确认；进程之后可重新打开）。',
        inputSchema: z.object({
          pid: z.number().int().describe('进程 PID（先用 run_diagnostic 跑 ps/top 查到）')
        }),
        riskLevel: 'irreversible',
        describe: (i) => `结束进程 PID ${i.pid}`,
        apply: async (i, shell) => {
          await shell('kill', [String(i.pid)])
          return `已结束进程 ${i.pid}`
        }
      },
      ctx
    ),

    restart_finder: createWriteTool(
      {
        description: '重启访达 Finder（卡住/图标异常时；会自动重新启动，安全）。',
        inputSchema: z.object({}),
        riskLevel: 'safe',
        describe: () => '重启访达 Finder',
        apply: async (_i, shell) => {
          await shell('killall', ['Finder'])
          return '已重启访达 Finder'
        }
      },
      ctx
    ),

    restart_dock: createWriteTool(
      {
        description: '重启程序坞 Dock（图标乱/不见/卡住时；会自动重新启动，安全）。',
        inputSchema: z.object({}),
        riskLevel: 'safe',
        describe: () => '重启程序坞 Dock',
        apply: async (_i, shell) => {
          await shell('killall', ['Dock'])
          return '已重启程序坞 Dock'
        }
      },
      ctx
    ),

    open_app: createWriteTool(
      {
        description: '打开/启动一个 App（"程序打不开"时尝试启动，或帮用户打开某软件）。',
        inputSchema: z.object({ name: z.string().describe('App 名称，如 Safari、微信') }),
        riskLevel: 'safe',
        describe: (i) => `打开 ${i.name}`,
        apply: async (i, shell) => {
          await shell('open', ['-a', i.name])
          return `已尝试打开 ${i.name}`
        }
      },
      ctx
    ),

    open_url: createWriteTool(
      {
        description: '在默认浏览器打开一个网址（如帮用户打开软件官方下载页）。',
        inputSchema: z.object({ url: z.string().describe('网址，如 https://...') }),
        riskLevel: 'safe',
        describe: (i) => `打开网址 ${i.url}`,
        apply: async (i, shell) => {
          await shell('open', [i.url])
          return `已打开 ${i.url}`
        }
      },
      ctx
    )
  }
}
