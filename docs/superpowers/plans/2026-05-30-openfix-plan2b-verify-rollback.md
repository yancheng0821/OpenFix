# OpenFix Plan 2b：验证器 + 失败自动回滚 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"全自动但可回滚"闭环——修复后自动复测，只有复测通过才保留改动；没通过或压根没复测就自动把所有改动还原，并老实报告"没修好也没搞坏"。

**Architecture:** 在 `packages/core` 加 `safety/Verification`（记录一次运行的复测结果）与 `tools/verify_connectivity`（复测工具：ping 目标并把通过/失败记进 Verification）。`runAgent` 收尾时执行策略：**若有改动且 `verification.passed !== true` → `changeLog.rollbackAll()` 并标记 `rolledBack`**。系统提示要求模型修复后必须复测。**全程 mock shell + mock model，不对真实系统做写操作。**

**Tech Stack:** TypeScript · Vercel AI SDK（`tool` / `MockLanguageModelV2`）· zod · Vitest。

> **范围（No silent caps）：** 本计划做"复测 + 失败自动回滚"的 core 闭环。**不含** GUI 的"我改了啥/一键还原"面板与不可逆硬确认弹窗（Plan 2c）。安全默认：有写但没成功复测 → 一律回滚（宁可少修，不留未验证的改动）。

---

## File Structure

```
packages/core/src/
├── safety/
│   ├── verification.ts        # Verification：记录复测通过/失败
│   └── verification.test.ts
├── tools/
│   ├── network-verify.ts      # verify_connectivity（复测并记 Verification）
│   └── network-verify.test.ts
├── run-agent.ts               # 收尾：复测未过则自动回滚（修改）
├── run-agent.test.ts          # 加：pass保留 / fail回滚 / 没复测也回滚（修改）
└── index.ts                   # 导出 AgentResult 已含 rolledBack（修改 run-agent 即可）
```

---

## Task 1: Verification（TDD）

**Files:**
- Create: `packages/core/src/safety/verification.ts`
- Test: `packages/core/src/safety/verification.test.ts`

- [ ] **Step 1: 写失败测试 `packages/core/src/safety/verification.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { Verification } from './verification'

describe('Verification', () => {
  it('初始未复测：passed=null, attempted=false', () => {
    const v = new Verification()
    expect(v.passed).toBeNull()
    expect(v.attempted).toBe(false)
  })

  it('record(true) 后 passed=true、attempted=true', () => {
    const v = new Verification()
    v.record(true)
    expect(v.passed).toBe(true)
    expect(v.attempted).toBe(true)
  })

  it('record(false) 后 passed=false', () => {
    const v = new Verification()
    v.record(false)
    expect(v.passed).toBe(false)
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/safety/verification.test.ts`
Expected: FAIL —— 找不到 `./verification`。

- [ ] **Step 3: 实现 `packages/core/src/safety/verification.ts`**

```ts
/** 一次运行的"修复后复测"结果；orchestrator 据此决定是否回滚。 */
export class Verification {
  private _passed: boolean | null = null

  /** 记录一次复测结果；以最后一次为准。 */
  record(passed: boolean): void {
    this._passed = passed
  }

  get passed(): boolean | null {
    return this._passed
  }

  get attempted(): boolean {
    return this._passed !== null
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/safety/verification.test.ts`
Expected: PASS（3 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/safety/verification.ts packages/core/src/safety/verification.test.ts
git commit -m "feat(core): Verification 复测结果记录"
```

---

## Task 2: verify_connectivity 复测工具（TDD）

**Files:**
- Create: `packages/core/src/tools/network-verify.ts`
- Test: `packages/core/src/tools/network-verify.test.ts`

- [ ] **Step 1: 写失败测试 `packages/core/src/tools/network-verify.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import type { ShellResult } from '../shell'
import { Verification } from '../safety/verification'
import { createNetworkVerifyTools } from './network-verify'

const okOptions = { toolCallId: 't1', messages: [] } as never

function shellWithPingCode(code: number): (c: string, a: string[]) => Promise<ShellResult> {
  return async () => ({ code, stdout: code === 0 ? 'time=10 ms' : 'Request timeout', stderr: '' })
}

describe('verify_connectivity', () => {
  it('ping 通：record(true) 且返回 reachable=true', async () => {
    const v = new Verification()
    const tools = createNetworkVerifyTools(shellWithPingCode(0), v)
    const res = await tools.verify_connectivity.execute!({ host: '8.8.8.8' }, okOptions)
    expect(res).toMatchObject({ host: '8.8.8.8', reachable: true })
    expect(v.passed).toBe(true)
  })

  it('ping 不通：record(false) 且返回 reachable=false', async () => {
    const v = new Verification()
    const tools = createNetworkVerifyTools(shellWithPingCode(2), v)
    const res = await tools.verify_connectivity.execute!({ host: '8.8.8.8' }, okOptions)
    expect(res).toMatchObject({ reachable: false })
    expect(v.passed).toBe(false)
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/tools/network-verify.test.ts`
Expected: FAIL —— 找不到 `./network-verify`。

- [ ] **Step 3: 实现 `packages/core/src/tools/network-verify.ts`**

```ts
import { z } from 'zod'
import { tool, type ToolSet } from 'ai'
import type { ShellRunner } from '../shell.js'
import type { Verification } from '../safety/verification.js'

/** 修复后复测连通性的工具：ping 目标并把通过/失败记进 Verification。 */
export function createNetworkVerifyTools(shell: ShellRunner, verification: Verification): ToolSet {
  return {
    verify_connectivity: tool({
      description: '在执行修复后，复测到某主机的连通性以确认问题是否真的解决（修复后必须调用）。',
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
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/tools/network-verify.test.ts`
Expected: PASS（2 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/tools/network-verify.ts packages/core/src/tools/network-verify.test.ts
git commit -m "feat(core): verify_connectivity 复测工具"
```

---

## Task 3: runAgent 复测→自动回滚（TDD）

**Files:**
- Modify: `packages/core/src/run-agent.ts`
- Modify: `packages/core/src/run-agent.test.ts`

- [ ] **Step 1: 在 `run-agent.test.ts` 顶部已有 import 下方加一个测试辅助 + 三个用例（放在最外层 describe 内、最后一个 `})` 之前）**

先在文件**顶部**已有 `import { z } from 'zod'` 等之后，加入辅助（若已存在 z 的 import 则复用）：

```ts
// —— 2b 辅助：可配置 ping 退出码的 mock shell（networksetup 恒成功）——
function mkShell(pingCode: number): {
  shell: (c: string, a: string[]) => Promise<{ code: number; stdout: string; stderr: string }>
  calls: string[]
} {
  const calls: string[] = []
  const shell = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args].join(' '))
    if (cmd === 'ping') return { code: pingCode, stdout: pingCode === 0 ? 'time=10 ms' : 'timeout', stderr: '' }
    if (args.includes('-getdnsservers')) return { code: 0, stdout: "There aren't any DNS Servers set on Wi-Fi.", stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { shell, calls }
}

// —— 2b 辅助：按脚本逐步返回的 mock 模型 ——
function scripted(steps: Array<{ tool?: { name: string; input: object }; text?: string }>): MockLanguageModelV2 {
  let i = 0
  return new MockLanguageModelV2({
    doGenerate: async () => {
      const step = steps[Math.min(i, steps.length - 1)]
      i += 1
      if (step.tool) {
        return {
          finishReason: 'tool-calls' as const,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: `c${i}`,
              toolName: step.tool.name,
              input: JSON.stringify(step.tool.input)
            }
          ],
          warnings: []
        }
      }
      return {
        finishReason: 'stop' as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: 'text' as const, text: step.text ?? '好了。' }],
        warnings: []
      }
    }
  })
}
```

然后加三个用例：

```ts
  it('改动后复测通过：保留改动，rolledBack=false', async () => {
    const { shell } = mkShell(0) // ping 通
    const model = scripted([
      { tool: { name: 'set_dns_servers', input: { service: 'Wi-Fi', servers: ['1.1.1.1'] } } },
      { tool: { name: 'verify_connectivity', input: { host: '8.8.8.8' } } },
      { text: '已修好。' }
    ])
    const result = await runAgent('网连不上', { model, shell })
    expect(result.rolledBack).toBe(false)
    expect(result.changes).toHaveLength(1)
  })

  it('改动后复测失败：自动回滚，rolledBack=true 且文案含还原', async () => {
    const { shell, calls } = mkShell(2) // ping 不通
    const model = scripted([
      { tool: { name: 'set_dns_servers', input: { service: 'Wi-Fi', servers: ['1.1.1.1'] } } },
      { tool: { name: 'verify_connectivity', input: { host: '8.8.8.8' } } },
      { text: '试着改了 DNS。' }
    ])
    const result = await runAgent('网连不上', { model, shell })
    expect(result.rolledBack).toBe(true)
    expect(result.text).toMatch(/还原/)
    // 回滚把 DNS 清回 Empty（快照为空）
    expect(calls).toContain('networksetup -setdnsservers Wi-Fi Empty')
  })

  it('改动后没复测：安全默认也回滚，rolledBack=true', async () => {
    const { shell } = mkShell(0)
    const model = scripted([
      { tool: { name: 'set_dns_servers', input: { service: 'Wi-Fi', servers: ['1.1.1.1'] } } },
      { text: '改完了（但没复测）。' }
    ])
    const result = await runAgent('网连不上', { model, shell })
    expect(result.rolledBack).toBe(true)
  })
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: FAIL —— `result.rolledBack` 为 undefined / `verify_connectivity` 不在工具集。

- [ ] **Step 3: 改 `packages/core/src/run-agent.ts`**

import 区加入：

```ts
import { Verification } from './safety/verification.js'
import { createNetworkVerifyTools } from './tools/network-verify.js'
```

`AgentResult` 增加 `rolledBack`：

```ts
export interface AgentResult {
  text: string
  toolCalls: Array<{ toolName: string; input: unknown }>
  changes: ChangeSummary[]
  rolledBack: boolean
}
```

`SYSTEM_PROMPT` 末尾追加复测要求（替换原常量为）：

```ts
const SYSTEM_PROMPT = `你是 OpenFix，帮普通人排查并修复电脑网络问题的助手。
先用只读工具查清情况；确有必要时可调用"可逆"修复工具（如改 DNS）——这类改动会自动记录、可一键还原。
执行任何修复后，必须调用 verify_connectivity 复测，只有复测通过才算修好。
不要执行没把握的或不可逆的破坏性操作。最后用简短的大白话告诉用户你查到/改了什么。`
```

默认工具集加入复测工具，并在收尾加回滚策略。把函数体中"构造 tools"与"return"之间替换为：

```ts
  const model = deps.model ?? getModel()
  const shell = deps.shell ?? runReadOnly
  const changeLog = new ChangeLog()
  const verification = new Verification()
  const tools =
    deps.tools ?? {
      ...createNetworkTools(shell),
      ...createNetworkFixTools({ shell, changeLog }),
      ...createNetworkVerifyTools(shell, verification)
    }

  const result = await generateText({
    model,
    tools,
    system: SYSTEM_PROMPT,
    ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
    stopWhen: stepCountIs(8)
  })

  const allToolCalls = result.steps.flatMap((s) => s.toolCalls)
  const applied = changeLog.list()

  // 收尾安全策略：有改动但复测没通过（或没复测）→ 自动全部还原
  let rolledBack = false
  if (applied.length > 0 && verification.passed !== true) {
    await changeLog.rollbackAll()
    rolledBack = true
  }

  let text = result.text
  if (rolledBack) {
    text = `${text}\n\n（修复没有通过复测，我已把改动全部还原，系统恢复原样。）`.trim()
  }

  return {
    text,
    toolCalls: allToolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
    changes: applied,
    rolledBack
  }
```

> 注：`stopWhen` 由 5 提到 8，给"诊断→修复→复测→作答"留足步数。

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: PASS（原有 + 新 3 = 共 6 用例）。

- [ ] **Step 5: 全量测试 + typecheck + build**

Run: `pnpm --filter @openfix/core test && pnpm --filter @openfix/core typecheck && pnpm --filter @openfix/core build`
Expected: 全 PASS / 无错。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/run-agent.ts packages/core/src/run-agent.test.ts
git commit -m "feat(core): 修复后自动复测，未通过则自动回滚（rolledBack）"
```

---

## Self-Review（对照 spec）

**1. Spec 覆盖（安全模型）：**
- "修完自动复测验证（重跑探测，确认真修好了）" → `verify_connectivity` + Verification（Task 1/2）✅
- "没好/更糟 → 自动回滚到原样" → runAgent 收尾 `verification.passed !== true` → `rollbackAll`（Task 3）✅
- "实在搞不定 → 老实报告没修好也没搞坏" → `rolledBack` + 追加还原文案（Task 3）✅
- **不覆盖（留 2c）**：GUI "我改了啥/一键还原" 面板、不可逆硬确认弹窗。

**2. 占位符扫描：** 无 TBD/TODO；代码与命令完整。✅

**3. 类型一致性：** `Verification`（record/passed/attempted）在 verification、network-verify、run-agent 三处一致；`createNetworkVerifyTools(shell, verification)` 返回 `ToolSet`；`AgentResult.rolledBack: boolean` 在 run-agent 定义与三个新测试断言一致；mock shell 的 ping 分支 `cmd === 'ping'` 与 network-fix/verify 实际调用 `shell('ping', …)` 一致。✅

**已知不确定性：** "没复测即回滚"是保守安全默认；若模型偶尔忘记复测会回滚掉本可保留的修复——可接受（宁可少修）。真实端到端（真改 DNS）仍留到 2c（有 GUI 还原入口后）。
