import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { ShellRunner } from '../shell.js'

/** 用注入的 shell runner 造出网络只读工具集（macOS：ping -c 1 -t 3）。 */
export function createNetworkTools(shell: ShellRunner): ToolSet {
  return {
    check_connectivity: tool({
      description:
        '测试本机到某主机的网络连通性（只读，不改动任何配置）。返回是否可达与往返延迟。',
      inputSchema: z.object({
        host: z.string().describe('要测试的主机名或 IP，例如 8.8.8.8 或 www.apple.com')
      }),
      execute: async ({ host }) => {
        const r = await shell('ping', ['-c', '1', '-t', '3', host], 6000)
        const reachable = r.code === 0
        const m = r.stdout.match(/time[=<]([\d.]+)\s*ms/)
        const latencyMs = m ? Number(m[1]) : null
        return { host, reachable, latencyMs, raw: (r.stdout || r.stderr).trim() }
      }
    })
  }
}
