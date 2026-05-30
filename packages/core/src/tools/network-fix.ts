import { z } from 'zod'
import type { ToolSet } from 'ai'
import { createWriteTool, type WriteToolContext } from '../safety/write-tool.js'

const dnsInput = z.object({
  service: z.string().describe('网络服务名，例如 Wi-Fi').default('Wi-Fi'),
  servers: z.array(z.string()).min(1).describe('要设置的 DNS 服务器，例如 ["8.8.8.8","1.1.1.1"]')
})

interface DnsSnapshot {
  service: string
  previous: string[]
}

/** macOS 改 DNS 的可逆写工具集（先快照当前 DNS，可一键还原）。 */
export function createNetworkFixTools(ctx: WriteToolContext): ToolSet {
  return {
    set_dns_servers: createWriteTool(
      {
        description: '修改某网络服务的 DNS 服务器（可逆：先记录当前值，可一键还原）。',
        inputSchema: dnsInput,
        riskLevel: 'reversible',
        describe: (i) => `把 ${i.service} 的 DNS 设为 ${i.servers.join(', ')}`,
        snapshot: async (i, shell): Promise<DnsSnapshot> => {
          const r = await shell('networksetup', ['-getdnsservers', i.service])
          const empty = /aren't any|there aren't/i.test(r.stdout)
          const previous = empty
            ? []
            : r.stdout
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
          return { service: i.service, previous }
        },
        apply: async (i, shell) => {
          await shell('networksetup', ['-setdnsservers', i.service, ...i.servers])
          return `已把 ${i.service} 的 DNS 设为 ${i.servers.join(', ')}`
        },
        rollback: async (snap, _i, shell) => {
          const s = snap as DnsSnapshot
          const args = s.previous.length > 0 ? s.previous : ['Empty']
          await shell('networksetup', ['-setdnsservers', s.service, ...args])
        }
      },
      ctx
    )
  }
}
