import { z } from 'zod'
import { tool, type ToolSet } from 'ai'
import type { ShellRunner } from '../shell.js'

/** 网络域只读诊断工具集（解析/代理/Wi-Fi）。 */
export function createNetworkDiagnosticTools(shell: ShellRunner): ToolSet {
  return {
    resolve_dns: tool({
      description: '检查某域名能否解析为 IP（只读）。用于区分"DNS 解析失败"和"能解析但连不上"。',
      inputSchema: z.object({ host: z.string().describe('域名，如 www.github.com') }),
      execute: async ({ host }) => {
        const r = await shell('dig', ['+short', host], 6000)
        const addresses = r.stdout
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
        return { host, resolved: addresses.length > 0, addresses }
      }
    }),
    check_proxy: tool({
      description: '查看某网络服务当前的 HTTP 代理设置（只读）。',
      inputSchema: z.object({ service: z.string().default('Wi-Fi').describe('网络服务名，如 Wi-Fi') }),
      execute: async ({ service }) => {
        const r = await shell('networksetup', ['-getwebproxy', service])
        const enabled = /Enabled:\s*Yes/i.test(r.stdout)
        const server = r.stdout.match(/Server:\s*(\S*)/)?.[1] ?? ''
        const port = r.stdout.match(/Port:\s*(\d+)/)?.[1] ?? ''
        return { service, enabled, server, port, raw: r.stdout.trim() }
      }
    }),
    get_wifi_info: tool({
      description: '查看当前连接的 Wi-Fi 网络（只读）。',
      inputSchema: z.object({ device: z.string().default('en0').describe('Wi-Fi 设备，通常 en0') }),
      execute: async ({ device }) => {
        const r = await shell('networksetup', ['-getairportnetwork', device])
        const m = r.stdout.match(/Current Wi-Fi Network:\s*(.*)/)
        const ssid = m ? m[1].trim() : null
        return { device, connected: ssid !== null, ssid, raw: r.stdout.trim() }
      }
    })
  }
}
