# OpenFix Plan 5：网络诊断深度（resolve_dns / check_proxy / get_wifi_info）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给网络域加 3 个只读诊断工具，让 agent 能区分"DNS 解析失败 / 代理配置错 / 没连 Wi-Fi"，而不只是 ping 通不通——把"连不上网 / 某网站打不开"这条 headline 链路的诊断做扎实。

**Architecture:** 新建 `tools/network-diagnostics.ts`（`createNetworkDiagnosticTools(shell)`，3 个只读工具），并入 `networkSkillPack.createTools`。**不改 `run-agent.ts`**（避开另一会话的 streamAgent 重构）。全程 mock shell。

**Tech Stack:** TypeScript · Vercel AI SDK · zod · Vitest · macOS `dig` / `networksetup`。

> **协调说明：** GUI 重设计 + 真流式由另一会话负责；本计划只动 `packages/core`，且不碰 `run-agent.ts` / GUI / IPC。
> **范围（No silent caps）：** 仅 3 个**只读**网络诊断工具。不含修复工具（代理设置等）与 DNS 解析以外的高级探测。

---

## File Structure

```
packages/core/src/
├── tools/
│   ├── network-diagnostics.ts       # resolve_dns / check_proxy / get_wifi_info（新建）
│   └── network-diagnostics.test.ts
└── skills/
    ├── network-pack.ts              # 并入诊断工具 + 更新 systemPrompt（修改）
    └── network-pack.test.ts         # 工具清单断言更新（修改）
```

---

## Task 1: createNetworkDiagnosticTools（TDD）

**Files:**
- Create: `packages/core/src/tools/network-diagnostics.ts`
- Test: `packages/core/src/tools/network-diagnostics.test.ts`

- [ ] **Step 1: 写失败测试 `packages/core/src/tools/network-diagnostics.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import type { ShellResult } from '../shell'
import { createNetworkDiagnosticTools } from './network-diagnostics'

const okOptions = { toolCallId: 't1', messages: [] } as never
const shellOut = (stdout: string) => async (): Promise<ShellResult> => ({ code: 0, stdout, stderr: '' })

describe('resolve_dns', () => {
  it('能解析：返回 resolved=true 与地址', async () => {
    const tools = createNetworkDiagnosticTools(shellOut('93.184.216.34\n'))
    const res = await tools.resolve_dns.execute!({ host: 'example.com' }, okOptions)
    expect(res).toMatchObject({ host: 'example.com', resolved: true, addresses: ['93.184.216.34'] })
  })

  it('解析失败：resolved=false、地址为空', async () => {
    const tools = createNetworkDiagnosticTools(shellOut(''))
    const res = await tools.resolve_dns.execute!({ host: 'nope.invalid' }, okOptions)
    expect(res).toMatchObject({ resolved: false, addresses: [] })
  })
})

describe('check_proxy', () => {
  it('代理开启：解析 enabled/server/port', async () => {
    const out = 'Enabled: Yes\nServer: 127.0.0.1\nPort: 7890\nAuthenticated Proxy Enabled: 0'
    const tools = createNetworkDiagnosticTools(shellOut(out))
    const res = await tools.check_proxy.execute!({ service: 'Wi-Fi' }, okOptions)
    expect(res).toMatchObject({ enabled: true, server: '127.0.0.1', port: '7890' })
  })

  it('代理关闭：enabled=false', async () => {
    const out = 'Enabled: No\nServer:\nPort: 0\nAuthenticated Proxy Enabled: 0'
    const tools = createNetworkDiagnosticTools(shellOut(out))
    const res = await tools.check_proxy.execute!({ service: 'Wi-Fi' }, okOptions)
    expect(res).toMatchObject({ enabled: false })
  })
})

describe('get_wifi_info', () => {
  it('已连接：解析 SSID', async () => {
    const tools = createNetworkDiagnosticTools(shellOut('Current Wi-Fi Network: MyHome-5G'))
    const res = await tools.get_wifi_info.execute!({ device: 'en0' }, okOptions)
    expect(res).toMatchObject({ connected: true, ssid: 'MyHome-5G' })
  })

  it('未连接：connected=false、ssid=null', async () => {
    const tools = createNetworkDiagnosticTools(shellOut('You are not associated with an AirPort network.'))
    const res = await tools.get_wifi_info.execute!({ device: 'en0' }, okOptions)
    expect(res).toMatchObject({ connected: false, ssid: null })
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/tools/network-diagnostics.test.ts`
Expected: FAIL —— 找不到 `./network-diagnostics`。

- [ ] **Step 3: 实现 `packages/core/src/tools/network-diagnostics.ts`**

```ts
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
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/tools/network-diagnostics.test.ts`
Expected: PASS（6 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/tools/network-diagnostics.ts packages/core/src/tools/network-diagnostics.test.ts
git commit -m "feat(core): 网络只读诊断工具 resolve_dns / check_proxy / get_wifi_info"
```

---

## Task 2: 并入 networkSkillPack（TDD）

**Files:**
- Modify: `packages/core/src/skills/network-pack.ts`
- Modify: `packages/core/src/skills/network-pack.test.ts`

- [ ] **Step 1: 更新 `network-pack.test.ts` 的工具清单断言**

把第一个用例里的断言改为（6 个，排序后）：

```ts
    expect(Object.keys(tools).sort()).toEqual([
      'check_connectivity',
      'check_proxy',
      'get_wifi_info',
      'resolve_dns',
      'set_dns_servers',
      'verify_connectivity'
    ])
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/skills/network-pack.test.ts`
Expected: FAIL —— 当前只有 3 个工具，缺 resolve_dns/check_proxy/get_wifi_info。

- [ ] **Step 3: 改 `packages/core/src/skills/network-pack.ts`**

顶部加 import：

```ts
import { createNetworkDiagnosticTools } from '../tools/network-diagnostics.js'
```

`createTools` 合并里加入诊断工具：

```ts
  createTools: (ctx) => ({
    ...createNetworkTools(ctx.shell),
    ...createNetworkDiagnosticTools(ctx.shell),
    ...createNetworkFixTools({ shell: ctx.shell, changeLog: ctx.changeLog, confirm: ctx.confirm }),
    ...createNetworkVerifyTools(ctx.shell, ctx.verification)
  }),
```

`systemPrompt` 更新为（补充新工具）：

```ts
  systemPrompt: `【网络域】只读诊断：check_connectivity（测连通）、resolve_dns（域名能否解析）、check_proxy（当前代理设置）、get_wifi_info（连的哪个 Wi-Fi）。可逆修复：set_dns_servers（改 DNS）。复测：verify_connectivity。任何修复后必须调用 verify_connectivity 复测，只有复测通过才算修好。`
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/skills/network-pack.test.ts`
Expected: PASS（2 用例）。

- [ ] **Step 5: 全量测试 + typecheck + build**

Run: `pnpm --filter @openfix/core test && pnpm --filter @openfix/core typecheck && pnpm --filter @openfix/core build`
Expected: 全 PASS / 无错。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/skills/network-pack.ts packages/core/src/skills/network-pack.test.ts
git commit -m "feat(core): networkSkillPack 并入 resolve_dns/check_proxy/get_wifi_info"
```

---

## Self-Review

**1. Spec 覆盖：** 网络域诊断深度（DNS 解析 / 代理 / Wi-Fi）✅；纯只读、加包就扩能力、不动引擎 ✅。
**2. 占位符扫描：** 无 TBD/TODO；代码与命令完整。✅
**3. 类型一致性：** `createNetworkDiagnosticTools(shell)` 返回 `ToolSet`，被 network-pack 用 `ctx.shell` 调用并合并；工具名（resolve_dns/check_proxy/get_wifi_info）在实现、两处测试、systemPrompt 一致。✅
**协调：** 仅触 `tools/network-diagnostics.ts`（新）+ `skills/network-pack.ts`（小改），不碰 `run-agent.ts`/GUI/IPC。✅
