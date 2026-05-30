# OpenFix Plan 6：通用只读诊断（白名单门控的 run_diagnostic）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"诊断（只读）"从"一个个手写工具"转向"模型自由跑命令"——给一个 **`run_diagnostic`** 工具，模型用自己的知识跑任意命令（dig/ping/df/networksetup -get*…），由**只读命令白名单**门控安全。一次策划白名单 = 无限诊断广度（Claude Code 式），但写操作仍走我们策划的可逆/确认工具。

**Architecture:** 新增 `safety/readonly-allowlist.ts`（`isReadOnlyAllowed(command,args)`：单纯只读命令放行、双用命令按子命令门控、默认拒绝）与 `tools/diagnostic.ts`（`createDiagnosticTools(shell)` 的 `run_diagnostic`：先过白名单，再用现有只读 shell 执行，返回 stdout/stderr/code；不用 shell 解释器、无管道/重定向，杜绝注入与隐蔽写）。**argv 形式**（command + args 分开）而非 shell 字符串，便于精确门控。

**Tech Stack:** TypeScript · Vercel AI SDK · zod · Vitest。

> **协调与范围（No silent caps）：** 另一会话在做 streamAgent（依赖现有 `createNetworkTools` 等读工具）。**本计划只建新文件、不接线、不退役旧读工具、不碰 run-agent.ts / 包文件**。接线（把 run_diagnostic 接进技能包 + 退役手写读工具 + 改 systemPrompt）作为**后续协调步骤**，待流式重构落地再做。
> **隐私注记：** 命令输出会发给云端 LLM；读到敏感文件即上云。本期接受（单机自助），完整隐私模式属主设计稿 M4。

---

## File Structure

```
packages/core/src/
├── safety/
│   ├── readonly-allowlist.ts        # isReadOnlyAllowed + 白名单数据（新建）
│   └── readonly-allowlist.test.ts
└── tools/
    ├── diagnostic.ts                # createDiagnosticTools：run_diagnostic（新建）
    └── diagnostic.test.ts
```

---

## Task 1: 只读命令白名单（TDD）

**Files:**
- Create: `packages/core/src/safety/readonly-allowlist.ts`
- Test: `packages/core/src/safety/readonly-allowlist.test.ts`

- [ ] **Step 1: 写失败测试 `packages/core/src/safety/readonly-allowlist.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { isReadOnlyAllowed } from './readonly-allowlist'

describe('isReadOnlyAllowed', () => {
  it('单纯只读命令放行', () => {
    expect(isReadOnlyAllowed('ping', ['8.8.8.8']).allowed).toBe(true)
    expect(isReadOnlyAllowed('dig', ['+short', 'github.com']).allowed).toBe(true)
    expect(isReadOnlyAllowed('df', ['-h', '/']).allowed).toBe(true)
  })

  it('双用命令：只读子命令放行、写子命令拒绝', () => {
    expect(isReadOnlyAllowed('networksetup', ['-getdnsservers', 'Wi-Fi']).allowed).toBe(true)
    expect(isReadOnlyAllowed('networksetup', ['-setdnsservers', 'Wi-Fi', '1.1.1.1']).allowed).toBe(false)
    expect(isReadOnlyAllowed('pmset', ['-g']).allowed).toBe(true)
    expect(isReadOnlyAllowed('pmset', ['-a', 'sleep', '0']).allowed).toBe(false)
  })

  it('明确危险命令拒绝', () => {
    expect(isReadOnlyAllowed('rm', ['-rf', '/']).allowed).toBe(false)
    expect(isReadOnlyAllowed('osascript', ['-e', 'x']).allowed).toBe(false)
    expect(isReadOnlyAllowed('sh', ['-c', 'rm x']).allowed).toBe(false)
  })

  it('未知命令默认拒绝（白名单制）', () => {
    const r = isReadOnlyAllowed('frobnicate', [])
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/白名单/)
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/safety/readonly-allowlist.test.ts`
Expected: FAIL —— 找不到 `./readonly-allowlist`。

- [ ] **Step 3: 实现 `packages/core/src/safety/readonly-allowlist.ts`**

```ts
export interface AllowResult {
  allowed: boolean
  reason?: string
}

/** 单纯只读、可直接放行的命令。 */
const ALWAYS_READONLY = new Set([
  'ping', 'dig', 'host', 'nslookup', 'traceroute', 'ifconfig', 'netstat', 'arp',
  'df', 'du', 'ls', 'ps', 'vm_stat', 'sw_vers', 'uname', 'system_profiler',
  'whoami', 'id', 'date', 'uptime', 'hostname', 'cat', 'head', 'tail'
])

/** 双用命令：只有满足条件的子命令/参数才算只读。 */
const GATED: Record<string, (args: string[]) => boolean> = {
  networksetup: (args) => /^-(get|list)/.test(args[0] ?? ''),
  pmset: (args) => args[0] === '-g',
  scutil: (args) => args.some((a) => a === '--dns' || a === '--proxy' || a === '--nwi'),
  top: (args) => args.includes('-l') // 需 -l <n> 一次性快照，非交互
}

/** 明确禁止（即便像"读"也拒绝，避免隐蔽写/任意执行）。 */
const NEVER = new Set([
  'rm', 'rmdir', 'mv', 'cp', 'dd', 'mkfs', 'kill', 'killall', 'shutdown', 'reboot',
  'osascript', 'sudo', 'sh', 'bash', 'zsh', 'curl', 'wget', 'defaults', 'launchctl',
  'diskutil', 'tmutil', 'chmod', 'chown', 'ln', 'touch'
])

/** 判断一条命令是否属于"可放行的只读诊断"。白名单制：未知一律拒绝。 */
export function isReadOnlyAllowed(command: string, args: string[]): AllowResult {
  if (NEVER.has(command)) {
    return { allowed: false, reason: `${command} 不是只读命令，请用专门的修复工具` }
  }
  if (ALWAYS_READONLY.has(command)) return { allowed: true }
  if (command in GATED) {
    return GATED[command](args)
      ? { allowed: true }
      : { allowed: false, reason: `${command} ${args[0] ?? ''} 不是只读子命令` }
  }
  return { allowed: false, reason: `${command} 不在只读白名单内（只读诊断只允许已知安全命令）` }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/safety/readonly-allowlist.test.ts`
Expected: PASS（4 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/safety/readonly-allowlist.ts packages/core/src/safety/readonly-allowlist.test.ts
git commit -m "feat(core): 只读命令白名单 isReadOnlyAllowed"
```

---

## Task 2: run_diagnostic 通用只读工具（TDD）

**Files:**
- Create: `packages/core/src/tools/diagnostic.ts`
- Test: `packages/core/src/tools/diagnostic.test.ts`

- [ ] **Step 1: 写失败测试 `packages/core/src/tools/diagnostic.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import type { ShellResult } from '../shell'
import { createDiagnosticTools } from './diagnostic'

const okOptions = { toolCallId: 't1', messages: [] } as never

describe('run_diagnostic', () => {
  it('白名单内：执行并返回 stdout', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]): Promise<ShellResult> => {
      calls.push([cmd, ...args].join(' '))
      return { code: 0, stdout: '93.184.216.34', stderr: '' }
    }
    const tools = createDiagnosticTools(shell)
    const res = (await tools.run_diagnostic.execute!(
      { command: 'dig', args: ['+short', 'example.com'] },
      okOptions
    )) as { ok: boolean; stdout: string }
    expect(res.ok).toBe(true)
    expect(res.stdout).toBe('93.184.216.34')
    expect(calls).toEqual(['dig +short example.com'])
  })

  it('白名单外：拒绝执行、不调 shell', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]): Promise<ShellResult> => {
      calls.push(cmd)
      return { code: 0, stdout: '', stderr: '' }
    }
    const tools = createDiagnosticTools(shell)
    const res = (await tools.run_diagnostic.execute!(
      { command: 'rm', args: ['-rf', '/'] },
      okOptions
    )) as { ok: boolean; refused?: string }
    expect(res.ok).toBe(false)
    expect(res.refused).toBeTruthy()
    expect(calls).toEqual([])
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/tools/diagnostic.test.ts`
Expected: FAIL —— 找不到 `./diagnostic`。

- [ ] **Step 3: 实现 `packages/core/src/tools/diagnostic.ts`**

```ts
import { z } from 'zod'
import { tool, type ToolSet } from 'ai'
import type { ShellRunner } from '../shell.js'
import { isReadOnlyAllowed } from '../safety/readonly-allowlist.js'

/** 通用只读诊断工具：模型自由跑只读命令，由白名单门控。 */
export function createDiagnosticTools(shell: ShellRunner): ToolSet {
  return {
    run_diagnostic: tool({
      description:
        '运行一条只读诊断命令来排查问题（如 dig/ping/df/networksetup -get*/scutil --dns 等）。只允许只读命令；要修复请用专门的修复工具。命令名与参数分开传，不要用管道/重定向。',
      inputSchema: z.object({
        command: z.string().describe('命令名，如 dig、ping、df、networksetup'),
        args: z.array(z.string()).default([]).describe('参数数组，如 ["+short","github.com"]')
      }),
      execute: async ({ command, args }) => {
        const gate = isReadOnlyAllowed(command, args)
        if (!gate.allowed) return { ok: false as const, refused: gate.reason }
        const r = await shell(command, args, 8000)
        return {
          ok: true as const,
          command: `${command} ${args.join(' ')}`.trim(),
          code: r.code,
          stdout: r.stdout.trim(),
          stderr: r.stderr.trim()
        }
      }
    })
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/tools/diagnostic.test.ts`
Expected: PASS（2 用例）。

- [ ] **Step 5: 全量测试 + typecheck + build**

Run: `pnpm --filter @openfix/core test && pnpm --filter @openfix/core typecheck && pnpm --filter @openfix/core build`
Expected: 全 PASS / 无错。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/tools/diagnostic.ts packages/core/src/tools/diagnostic.test.ts
git commit -m "feat(core): run_diagnostic 通用只读诊断工具（白名单门控）"
```

---

## 后续（接线，待协调）— 不在本计划

待流式重构落地后，另起计划：
1. 把 `run_diagnostic` 接进 networkSkillPack / systemSkillPack（或核心默认工具）。
2. 退役手写读工具（check_connectivity/resolve_dns/check_proxy/get_wifi_info/check_disk_space/check_app_installed），改由 run_diagnostic 覆盖；保留写工具与 verify_connectivity。
3. 更新各包 systemPrompt：指导模型用 run_diagnostic 跑相应命令；保留"修复用专门工具 + 必须复测"的纪律。

## Self-Review

**1. 覆盖：** 通用只读 shell（白名单门控）= A 方案核心 ✅；写操作仍策划（不在本计划，未改动）✅。
**2. 占位符：** 无 TBD/TODO；代码命令完整。✅
**3. 类型一致性：** `isReadOnlyAllowed(command,args): AllowResult` 在 allowlist 定义、diagnostic 调用一致；`run_diagnostic` execute 返回 `{ok:true,...}`/`{ok:false,refused}` 与测试断言一致；新文件不触碰 run-agent.ts / 包 / GUI。✅
**协调：** 纯新增文件，零接线，不破坏 streamAgent 依赖的现有读工具。✅
