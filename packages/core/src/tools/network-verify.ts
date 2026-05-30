import { z } from 'zod'
import { tool, type ToolSet } from 'ai'
import type { ShellRunner } from '../shell.js'
import type { Verification } from '../safety/verification.js'

/** 修复后复测连通性的工具：ping 目标并把通过/失败记进 Verification。 */
export function createNetworkVerifyTools(shell: ShellRunner, verification: Verification): ToolSet {
  return {
    verify_connectivity: tool({
      description:
        '在执行修复后，复测到某主机的连通性以确认问题是否真的解决（修复后必须调用）。',
      inputSchema: z.object({
        host: z.string().describe('复测目标，如 8.8.8.8 或 www.apple.com')
      }),
      execute: async ({ host }) => {
        const r = await shell('ping', ['-c', '1', '-t', '3', host], 6000)
        const reachable = r.code === 0
        verification.record(reachable)
        return { host, reachable }
      }
    })
  }
}
