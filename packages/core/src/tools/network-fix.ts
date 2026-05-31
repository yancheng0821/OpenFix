import { z } from 'zod'
import type { ToolSet } from 'ai'
import { createWriteTool, type WriteToolContext } from '../safety/write-tool.js'
import type { ShellRunner } from '../shell.js'

const dnsInput = z.object({
  service: z.string().describe('网络服务名，例如 Wi-Fi').default('Wi-Fi'),
  servers: z.array(z.string()).min(1).describe('要设置的 DNS 服务器，例如 ["8.8.8.8","1.1.1.1"]')
})

interface DnsSnapshot {
  service: string
  previous: string[]
}

interface ProxyState {
  enabled: boolean
  server: string
  port: string
}
interface ProxySnapshot {
  service: string
  web: ProxyState
  secure: ProxyState
}

function parseProxy(stdout: string): ProxyState {
  return {
    enabled: /Enabled:\s*Yes/i.test(stdout),
    server: stdout.match(/Server:\s*(\S*)/)?.[1] ?? '',
    port: stdout.match(/Port:\s*(\d+)/)?.[1] ?? ''
  }
}

async function readProxy(service: string, shell: ShellRunner): Promise<ProxySnapshot> {
  const web = parseProxy((await shell('networksetup', ['-getwebproxy', service])).stdout)
  const secure = parseProxy((await shell('networksetup', ['-getsecurewebproxy', service])).stdout)
  return { service, web, secure }
}

async function restoreProxy(
  kind: 'web' | 'secure',
  service: string,
  st: ProxyState,
  shell: ShellRunner
): Promise<void> {
  const set = kind === 'web' ? '-setwebproxy' : '-setsecurewebproxy'
  const state = kind === 'web' ? '-setwebproxystate' : '-setsecurewebproxystate'
  if (st.enabled && st.server) {
    await shell('networksetup', [set, service, st.server, st.port || '0'])
  } else {
    await shell('networksetup', [state, service, 'off'])
  }
}

interface WifiSnapshot {
  device: string
  wasOn: boolean
}

/** 网络域可逆修复工具集（改前快照、可一键还原）。 */
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
    ),

    clear_proxy: createWriteTool(
      {
        description: '关闭某网络服务的 HTTP/HTTPS 代理（可逆：先记录当前代理设置，可一键还原）。常用于排除挡路的代理。',
        inputSchema: z.object({
          service: z.string().default('Wi-Fi').describe('网络服务名，例如 Wi-Fi')
        }),
        riskLevel: 'reversible',
        describe: (i) => `关闭 ${i.service} 的代理`,
        snapshot: async (i, shell): Promise<ProxySnapshot> => readProxy(i.service, shell),
        apply: async (i, shell) => {
          await shell('networksetup', ['-setwebproxystate', i.service, 'off'])
          await shell('networksetup', ['-setsecurewebproxystate', i.service, 'off'])
          return `已关闭 ${i.service} 的代理`
        },
        rollback: async (snap, _i, shell) => {
          const s = snap as ProxySnapshot
          await restoreProxy('web', s.service, s.web, shell)
          await restoreProxy('secure', s.service, s.secure, shell)
        }
      },
      ctx
    ),

    restart_wifi: createWriteTool(
      {
        description: '重启 Wi-Fi（先关后开，可逆）。常用于修复连上但没网、网卡假死。',
        inputSchema: z.object({
          device: z.string().default('en0').describe('Wi-Fi 设备，通常 en0')
        }),
        riskLevel: 'reversible',
        describe: (i) => `重启 Wi-Fi（${i.device}）`,
        snapshot: async (i, shell): Promise<WifiSnapshot> => {
          const r = await shell('networksetup', ['-getairportpower', i.device])
          return { device: i.device, wasOn: /:\s*On/i.test(r.stdout) }
        },
        apply: async (i, shell) => {
          await shell('networksetup', ['-setairportpower', i.device, 'off'])
          await shell('networksetup', ['-setairportpower', i.device, 'on'])
          return `已重启 Wi-Fi（${i.device}）`
        },
        rollback: async (snap, _i, shell) => {
          const s = snap as WifiSnapshot
          await shell('networksetup', ['-setairportpower', s.device, s.wasOn ? 'on' : 'off'])
        }
      },
      ctx
    )
  }
}
