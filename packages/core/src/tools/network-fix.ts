import { z } from 'zod'
import type { ToolSet } from 'ai'
import { createWriteTool, type WriteToolContext } from '../safety/write-tool.js'
import type { ShellRunner } from '../shell.js'

const dnsInput = z.object({
  service: z
    .string()
    .optional()
    .describe('网络服务名（如 Wi-Fi / USB 10/100/1000 LAN）；留空则自动作用于当前活动网卡，推荐留空'),
  servers: z.array(z.string()).min(1).describe('要设置的 DNS 服务器，例如 ["8.8.8.8","1.1.1.1"]')
})

/** 从 `networksetup -listnetworkserviceorder` 输出里，按设备名(enX)找出对应的网络服务名。 */
export function serviceForDevice(order: string, device: string): string | null {
  let lastService: string | null = null
  for (const line of order.split('\n')) {
    const name = line.match(/^\(\*?\d+\)\s+(.+?)\s*$/)
    if (name) {
      lastService = name[1].trim()
      continue
    }
    const dev = line.match(/Device:\s*([^,)\s]+)/)
    if (dev && dev[1] === device) return lastService
  }
  return null
}

/** 从 `networksetup -listallhardwareports` 输出里，按硬件端口名找出设备名(enX)。 */
export function deviceForHardwarePort(out: string, port: string): string | null {
  const lines = out.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const p = lines[i].match(/^Hardware Port:\s*(.+?)\s*$/)
    if (p && p[1].trim() === port) {
      for (let j = i + 1; j < lines.length; j++) {
        const d = lines[j].match(/^Device:\s*(\S+)/)
        if (d) return d[1]
        if (/^Hardware Port:/.test(lines[j])) break
      }
    }
  }
  return null
}

/** 解析「当前活动网卡」对应的网络服务名：默认路由的 interface → 服务名。查不到回退 Wi-Fi。 */
async function resolveActiveService(shell: ShellRunner): Promise<string> {
  const r = await shell('route', ['-n', 'get', 'default'])
  const iface = r.stdout.match(/interface:\s*(\S+)/)?.[1]
  if (!iface) return 'Wi-Fi'
  const order = await shell('networksetup', ['-listnetworkserviceorder'])
  return serviceForDevice(order.stdout, iface) ?? 'Wi-Fi'
}

/** 解析 Wi-Fi 硬件端口对应的设备名（en0/en1…）。查不到回退 en0。 */
async function resolveWifiDevice(shell: ShellRunner): Promise<string> {
  const r = await shell('networksetup', ['-listallhardwareports'])
  return deviceForHardwarePort(r.stdout, 'Wi-Fi') ?? 'en0'
}

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
        describe: (i) => `把 ${i.service ?? '当前网络'} 的 DNS 设为 ${i.servers.join(', ')}`,
        snapshot: async (i, shell): Promise<DnsSnapshot> => {
          const service = i.service || (await resolveActiveService(shell))
          const r = await shell('networksetup', ['-getdnsservers', service])
          const empty = /aren't any|there aren't/i.test(r.stdout)
          const previous = empty
            ? []
            : r.stdout
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
          return { service, previous }
        },
        apply: async (i, shell) => {
          const service = i.service || (await resolveActiveService(shell))
          await shell('networksetup', ['-setdnsservers', service, ...i.servers])
          return `已把 ${service} 的 DNS 设为 ${i.servers.join(', ')}`
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
          service: z
            .string()
            .optional()
            .describe('网络服务名；留空则自动作用于当前活动网卡，推荐留空')
        }),
        riskLevel: 'reversible',
        describe: (i) => `关闭 ${i.service ?? '当前网络'} 的代理`,
        snapshot: async (i, shell): Promise<ProxySnapshot> =>
          readProxy(i.service || (await resolveActiveService(shell)), shell),
        apply: async (i, shell) => {
          const service = i.service || (await resolveActiveService(shell))
          await shell('networksetup', ['-setwebproxystate', service, 'off'])
          await shell('networksetup', ['-setsecurewebproxystate', service, 'off'])
          return `已关闭 ${service} 的代理`
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
          device: z.string().optional().describe('Wi-Fi 设备；留空则自动探测（通常 en0）')
        }),
        riskLevel: 'reversible',
        describe: (i) => `重启 Wi-Fi（${i.device ?? '自动探测'}）`,
        snapshot: async (i, shell): Promise<WifiSnapshot> => {
          const device = i.device || (await resolveWifiDevice(shell))
          const r = await shell('networksetup', ['-getairportpower', device])
          return { device, wasOn: /:\s*On/i.test(r.stdout) }
        },
        apply: async (i, shell) => {
          const device = i.device || (await resolveWifiDevice(shell))
          await shell('networksetup', ['-setairportpower', device, 'off'])
          await shell('networksetup', ['-setairportpower', device, 'on'])
          return `已重启 Wi-Fi（${device}）`
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
