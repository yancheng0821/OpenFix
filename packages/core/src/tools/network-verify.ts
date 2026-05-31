import { z } from 'zod'
import { tool, type ToolSet } from 'ai'
import type { ShellRunner } from '../shell.js'
import type { Verification } from '../safety/verification.js'

/** Apple 的 captive 检测端点：返回 200 即代表真的能上网（含 DNS/代理/路由全链路）。 */
const DEFAULT_PROBE = 'http://captive.apple.com/hotspot-detect.html'

/**
 * 修复后复测「真的能上网」的工具：
 * 用 curl 实打实发一个 HTTP 请求（默认走 Apple captive 端点），拿到 2xx/3xx 才算通过。
 * 之所以不用 ping：ping 通 IP 只说明三层可达，DNS 劫持/代理挡路时浏览器照样打不开，
 * 必须用真实 HTTP 请求才能反映用户真正关心的「能不能上网」。
 */
export function createNetworkVerifyTools(shell: ShellRunner, verification: Verification): ToolSet {
  return {
    verify_connectivity: tool({
      description:
        '在执行修复后，真实复测「能不能上网」以确认问题是否解决（发一个 HTTP 请求，比 ping 更可信；修复后必须调用）。',
      inputSchema: z.object({
        url: z
          .string()
          .optional()
          .describe('复测用的网址，默认 Apple 联网检测端点；也可传具体站点如 https://www.baidu.com')
      }),
      execute: async ({ url }) => {
        const target = url || DEFAULT_PROBE
        const r = await shell(
          'curl',
          ['-sS', '-L', '-m', '6', '-o', '/dev/null', '-w', '%{http_code}', target],
          8000
        )
        const status = r.stdout.trim()
        const reachable = r.code === 0 && /^[23]\d\d$/.test(status)
        verification.record(reachable)
        return { url: target, status, reachable }
      }
    })
  }
}
