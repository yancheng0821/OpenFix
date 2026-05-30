import { z } from 'zod'
import type { ToolSet } from 'ai'
import { createWriteTool, type WriteToolContext } from '../safety/write-tool.js'

/** 软件/系统域不可逆写工具（需用户确认）。 */
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
    )
  }
}
