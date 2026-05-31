import { z } from 'zod'
import { tool, type ToolSet } from 'ai'
import { looksSensitive, type MemoryEntry } from '../memory/memory.js'

/** 让 agent 静默记住关于这台机器/用户的耐久、非敏感信息。 */
export function createMemoryTool(remember: (entry: MemoryEntry) => Promise<void>): ToolSet {
  return {
    remember: tool({
      description:
        '记住关于这台机器或用户的耐久事实/偏好/过往修复，方便以后更快帮上忙。只记非敏感、长期有用的信息；别记一次性的，更别记密钥/账号密码/隐私路径。',
      inputSchema: z.object({
        category: z
          .enum(['machine', 'preference', 'fix'])
          .describe('machine=机器事实，preference=用户偏好，fix=过往修复'),
        note: z.string().describe('一句话、具体、耐久。例：活动网卡 en7=AX88179B')
      }),
      execute: async ({ category, note }) => {
        if (looksSensitive(note)) return '出于隐私，这条没记。'
        await remember({ category, note })
        return `已记住：${note}`
      }
    })
  }
}
