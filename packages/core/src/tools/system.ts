import { z } from 'zod'
import { tool, type ToolSet } from 'ai'
import type { ShellRunner } from '../shell.js'

/** 软件/系统域只读诊断工具集。 */
export function createSystemTools(shell: ShellRunner): ToolSet {
  return {
    check_disk_space: tool({
      description: '查看主磁盘（根分区）的占用情况（只读）。',
      inputSchema: z.object({}),
      execute: async () => {
        const r = await shell('df', ['-h', '/'])
        const lines = r.stdout.trim().split('\n')
        const data = lines[lines.length - 1].trim().split(/\s+/)
        // macOS df -h 数据行：[Filesystem, Size, Used, Avail, Capacity, ...]
        return {
          size: data[1] ?? null,
          used: data[2] ?? null,
          available: data[3] ?? null,
          usedPercent: data[4] ?? null,
          raw: r.stdout.trim()
        }
      }
    }),
    check_app_installed: tool({
      description: '检查某个图形软件是否已安装（查 /Applications，只读）。',
      inputSchema: z.object({ name: z.string().describe('软件名，如 Chrome、微信') }),
      execute: async ({ name }) => {
        const r = await shell('ls', ['/Applications'])
        const apps = r.stdout
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
        const matches = apps.filter((a) => a.toLowerCase().includes(name.toLowerCase()))
        return { name, installed: matches.length > 0, matches }
      }
    })
  }
}
