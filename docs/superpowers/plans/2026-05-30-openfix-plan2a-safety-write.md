# OpenFix Plan 2a：可逆写地基（快照/回滚 + 写工具 + 安全分级）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让引擎从"只会诊断"迈出"真能改"的第一步——具备"改动前自动快照、改动可一键回滚、不可逆操作必须确认"的安全地基，并落第一个可逆写工具（改 DNS）。

**Architecture:** 在 `packages/core` 加 `safety/` 子模块：`ChangeLog`（记录每次改动 + 反向回滚）、`createWriteTool`（把"快照→应用→记账"的写操作包成 AI SDK 工具，按风险分级——可逆自动执行+快照，不可逆无授权则拒绝）。第一个写工具 `set_dns_servers` 用 macOS `networksetup`。`runAgent` 每次运行建一个 `ChangeLog`，把改动摘要随结果返回。**全程用注入的 mock shell 做 TDD，不对真实系统做任何写操作。**

**Tech Stack:** TypeScript · Vercel AI SDK（`tool`）· zod · Vitest · macOS `networksetup`。

> **范围（No silent caps）：** 本计划只做"可逆写 + 快照 + 回滚 + 不可逆拒绝"的地基与 DNS 工具。**不含**：失败后自动复测/自动回滚（Plan 2b）；GUI 的"我改了啥/一键还原"与不可逆硬确认弹窗（Plan 2c）。因此 `runAgent` 仅把 `changes` 摘要随结果返回，真正的用户侧回滚入口留到 2c。**本计划不做任何真实 DNS 改动的端到端 smoke**（会改动开发机网络），写工具仅以 mock shell 单测；真实可逆写的端到端留到 2c（有还原入口后）。

---

## File Structure

```
packages/core/src/
├── safety/
│   ├── change-log.ts        # ChangeLog：记录改动 + 反向 rollbackAll；list() 给出可序列化摘要
│   ├── change-log.test.ts
│   ├── write-tool.ts        # createWriteTool：快照→(分级)→应用→记账；不可逆需 confirm
│   └── write-tool.test.ts
├── tools/
│   ├── network-fix.ts       # set_dns_servers（可逆写，networksetup）
│   └── network-fix.test.ts
├── run-agent.ts             # 集成：每次运行建 ChangeLog，结果带 changes（修改）
├── run-agent.test.ts        # 加：写工具调用被记账（修改）
└── index.ts                 # 导出 ChangeSummary / RiskLevel（修改）
```

职责：`change-log` 只管"记账与回滚"；`write-tool` 只管"把写操作安全地包成工具"；`network-fix` 只管"DNS 这一个具体可逆写"；`run-agent` 只管"把 ChangeLog 接进 loop 并把摘要带出"。

---

## Task 1: ChangeLog（TDD）

**Files:**
- Create: `packages/core/src/safety/change-log.ts`
- Test: `packages/core/src/safety/change-log.test.ts`

- [ ] **Step 1: 写失败测试 `packages/core/src/safety/change-log.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { ChangeLog } from './change-log'

describe('ChangeLog', () => {
  it('list() 返回可序列化摘要（不含 rollback 函数）', () => {
    const log = new ChangeLog()
    log.record({ description: '改了 DNS', riskLevel: 'reversible', rollback: async () => {} })
    const list = log.list()
    expect(list).toEqual([{ id: 1, description: '改了 DNS', riskLevel: 'reversible' }])
    expect((list[0] as Record<string, unknown>).rollback).toBeUndefined()
  })

  it('rollbackAll() 以相反顺序调用各 rollback 并清空', async () => {
    const log = new ChangeLog()
    const order: number[] = []
    log.record({ description: 'A', riskLevel: 'reversible', rollback: async () => void order.push(1) })
    log.record({ description: 'B', riskLevel: 'reversible', rollback: async () => void order.push(2) })
    await log.rollbackAll()
    expect(order).toEqual([2, 1]) // 后改的先回滚（LIFO）
    expect(log.list()).toEqual([])
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/safety/change-log.test.ts`
Expected: FAIL —— 找不到 `./change-log` / `ChangeLog`。

- [ ] **Step 3: 实现 `packages/core/src/safety/change-log.ts`**

```ts
export type RiskLevel = 'reversible' | 'irreversible'

export interface ChangeEntry {
  id: number
  description: string
  riskLevel: RiskLevel
  rollback: () => Promise<void>
}

export interface ChangeSummary {
  id: number
  description: string
  riskLevel: RiskLevel
}

/** 一次运行中所有写操作的账本：记录改动并支持按 LIFO 回滚。 */
export class ChangeLog {
  private entries: ChangeEntry[] = []
  private nextId = 1

  record(entry: Omit<ChangeEntry, 'id'>): number {
    const id = this.nextId++
    this.entries.push({ id, ...entry })
    return id
  }

  list(): ChangeSummary[] {
    return this.entries.map(({ id, description, riskLevel }) => ({ id, description, riskLevel }))
  }

  async rollbackAll(): Promise<void> {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      await this.entries[i].rollback()
    }
    this.entries = []
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/safety/change-log.test.ts`
Expected: PASS（2 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/safety/change-log.ts packages/core/src/safety/change-log.test.ts
git commit -m "feat(core): ChangeLog 改动账本（记录+LIFO 回滚）"
```

---

## Task 2: createWriteTool 写工具工厂（TDD）

**Files:**
- Create: `packages/core/src/safety/write-tool.ts`
- Test: `packages/core/src/safety/write-tool.test.ts`

写工具的 execute 流程：不可逆且无授权 → 拒绝；否则 快照 → 应用 → 记账（带回滚）。

- [ ] **Step 1: 写失败测试 `packages/core/src/safety/write-tool.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ChangeLog } from './change-log'
import { createWriteTool, type WriteToolContext } from './write-tool'

const okOptions = { toolCallId: 't1', messages: [] } as never

function makeCtx(over: Partial<WriteToolContext> = {}): WriteToolContext {
  return {
    shell: async () => ({ code: 0, stdout: '', stderr: '' }),
    changeLog: new ChangeLog(),
    ...over
  }
}

const spec = {
  description: '示例可逆写',
  inputSchema: z.object({ value: z.string() }),
  riskLevel: 'reversible' as const,
  describe: (i: { value: string }) => `设为 ${i.value}`,
  snapshot: async () => ({ prev: 'old' }),
  apply: async (i: { value: string }) => `已设为 ${i.value}`,
  rollback: async () => {}
}

describe('createWriteTool', () => {
  it('可逆写：快照→应用→记账，结果为 apply 返回值', async () => {
    const ctx = makeCtx()
    const t = createWriteTool(spec, ctx)
    const out = await t.execute!({ value: 'X' }, okOptions)
    expect(out).toBe('已设为 X')
    expect(ctx.changeLog.list()).toEqual([{ id: 1, description: '设为 X', riskLevel: 'reversible' }])
  })

  it('记账的 rollback 真正调用 spec.rollback', async () => {
    let rolledBack = false
    const ctx = makeCtx()
    const t = createWriteTool({ ...spec, rollback: async () => void (rolledBack = true) }, ctx)
    await t.execute!({ value: 'X' }, okOptions)
    await ctx.changeLog.rollbackAll()
    expect(rolledBack).toBe(true)
  })

  it('不可逆写且无 confirm：拒绝执行，不记账', async () => {
    const ctx = makeCtx()
    const t = createWriteTool({ ...spec, riskLevel: 'irreversible' }, ctx)
    const out = (await t.execute!({ value: 'X' }, okOptions)) as string
    expect(out).toMatch(/拒绝|未获授权/)
    expect(ctx.changeLog.list()).toEqual([])
  })

  it('不可逆写且 confirm 返回 true：执行并记账', async () => {
    const ctx = makeCtx({ confirm: async () => true })
    const t = createWriteTool({ ...spec, riskLevel: 'irreversible' }, ctx)
    await t.execute!({ value: 'X' }, okOptions)
    expect(ctx.changeLog.list()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/safety/write-tool.test.ts`
Expected: FAIL —— 找不到 `./write-tool`。

- [ ] **Step 3: 实现 `packages/core/src/safety/write-tool.ts`**

```ts
import { tool, type Tool } from 'ai'
import { z } from 'zod'
import type { ShellRunner } from '../shell.js'
import type { ChangeLog, RiskLevel } from './change-log.js'

/** 每次运行注入给写工具的上下文：shell、账本、（不可逆操作用的）确认回调。 */
export interface WriteToolContext {
  shell: ShellRunner
  changeLog: ChangeLog
  confirm?: (description: string) => Promise<boolean>
}

export interface WriteToolSpec<S extends z.ZodTypeAny> {
  description: string
  inputSchema: S
  riskLevel: RiskLevel
  describe: (input: z.infer<S>) => string
  snapshot: (input: z.infer<S>, shell: ShellRunner) => Promise<unknown>
  apply: (input: z.infer<S>, shell: ShellRunner) => Promise<string>
  rollback: (snapshot: unknown, input: z.infer<S>, shell: ShellRunner) => Promise<void>
}

/** 把一个写操作包成 AI SDK 工具：可逆自动执行+快照记账；不可逆需 confirm，否则拒绝。 */
export function createWriteTool<S extends z.ZodTypeAny>(
  spec: WriteToolSpec<S>,
  ctx: WriteToolContext
): Tool {
  return tool({
    description: spec.description,
    inputSchema: spec.inputSchema,
    execute: async (input: z.infer<S>) => {
      const desc = spec.describe(input)
      if (spec.riskLevel === 'irreversible') {
        const ok = ctx.confirm ? await ctx.confirm(desc) : false
        if (!ok) return `已拒绝执行（不可逆操作需用户确认，未获授权）：${desc}`
      }
      const snap = await spec.snapshot(input, ctx.shell)
      const result = await spec.apply(input, ctx.shell)
      ctx.changeLog.record({
        description: desc,
        riskLevel: spec.riskLevel,
        rollback: () => spec.rollback(snap, input, ctx.shell)
      })
      return result
    }
  })
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/safety/write-tool.test.ts`
Expected: PASS（4 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/safety/write-tool.ts packages/core/src/safety/write-tool.test.ts
git commit -m "feat(core): createWriteTool 写工具工厂（分级+快照记账+不可逆拒绝）"
```

---

## Task 3: set_dns_servers 可逆写工具（TDD）

**Files:**
- Create: `packages/core/src/tools/network-fix.ts`
- Test: `packages/core/src/tools/network-fix.test.ts`

macOS：`networksetup -getdnsservers <服务>` 读当前；`-setdnsservers <服务> <ip...>` 设置；`-setdnsservers <服务> Empty` 清空。

- [ ] **Step 1: 写失败测试 `packages/core/src/tools/network-fix.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { ChangeLog } from '../safety/change-log'
import type { ShellResult } from '../shell'
import { createNetworkFixTools } from './network-fix'

const okOptions = { toolCallId: 't1', messages: [] } as never

/** 记录 shell 调用、并按子命令返回设定输出。 */
function mockShell(getdnsOut: string): { shell: (c: string, a: string[]) => Promise<ShellResult>; calls: string[] } {
  const calls: string[] = []
  const shell = async (cmd: string, args: string[]): Promise<ShellResult> => {
    calls.push([cmd, ...args].join(' '))
    if (args.includes('-getdnsservers')) return { code: 0, stdout: getdnsOut, stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { shell, calls }
}

describe('set_dns_servers', () => {
  it('应用：先 get 快照，再 set 新 DNS，并记账', async () => {
    const { shell, calls } = mockShell('8.8.4.4\n8.8.8.8')
    const changeLog = new ChangeLog()
    const tools = createNetworkFixTools({ shell, changeLog })
    const out = (await tools.set_dns_servers.execute!(
      { service: 'Wi-Fi', servers: ['1.1.1.1'] },
      okOptions
    )) as string

    expect(out).toMatch(/1\.1\.1\.1/)
    expect(calls).toContain('networksetup -getdnsservers Wi-Fi')
    expect(calls).toContain('networksetup -setdnsservers Wi-Fi 1.1.1.1')
    expect(changeLog.list()).toHaveLength(1)
  })

  it('回滚：恢复到快照里的原 DNS', async () => {
    const { shell, calls } = mockShell('8.8.4.4\n8.8.8.8')
    const changeLog = new ChangeLog()
    const tools = createNetworkFixTools({ shell, changeLog })
    await tools.set_dns_servers.execute!({ service: 'Wi-Fi', servers: ['1.1.1.1'] }, okOptions)
    await changeLog.rollbackAll()
    expect(calls).toContain('networksetup -setdnsservers Wi-Fi 8.8.4.4 8.8.8.8')
  })

  it('原本没有 DNS：回滚用 Empty 清空', async () => {
    const { shell, calls } = mockShell("There aren't any DNS Servers set on Wi-Fi.")
    const changeLog = new ChangeLog()
    const tools = createNetworkFixTools({ shell, changeLog })
    await tools.set_dns_servers.execute!({ service: 'Wi-Fi', servers: ['1.1.1.1'] }, okOptions)
    await changeLog.rollbackAll()
    expect(calls).toContain('networksetup -setdnsservers Wi-Fi Empty')
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/tools/network-fix.test.ts`
Expected: FAIL —— 找不到 `./network-fix`。

- [ ] **Step 3: 实现 `packages/core/src/tools/network-fix.ts`**

```ts
import { z } from 'zod'
import { tool, type ToolSet } from 'ai'
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

/** macOS 改 DNS 的可逆写工具集（先快照当前 DNS，可一键还原）。 */
export function createNetworkFixTools(ctx: WriteToolContext): ToolSet {
  void tool // 仅为与读工具风格一致而保留 ai 导入（createWriteTool 内部用 tool）
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
```

> 注：`void tool` 那行是为了消除"导入未使用"告警的占位写法；若你的 lint 不报该警告，可删掉 `import { tool, ... }` 里的 `tool` 与该行，只保留 `import { type ToolSet } from 'ai'`。

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/tools/network-fix.test.ts`
Expected: PASS（3 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/tools/network-fix.ts packages/core/src/tools/network-fix.test.ts
git commit -m "feat(core): set_dns_servers 可逆写工具（快照+回滚）"
```

---

## Task 4: 接入 runAgent（结果带 changes）+ 导出（TDD）

**Files:**
- Modify: `packages/core/src/run-agent.ts`
- Modify: `packages/core/src/run-agent.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 在 `run-agent.test.ts` 末尾（最后一个 `})` 之前）加用例：写工具调用被记进 changes**

```ts
  it('调用写工具后，结果的 changes 记录该改动', async () => {
    let call = 0
    const model = new MockLanguageModelV2({
      doGenerate: async () => {
        call += 1
        if (call === 1) {
          return {
            finishReason: 'tool-calls' as const,
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: 'c1',
                toolName: 'set_dns_servers',
                input: JSON.stringify({ service: 'Wi-Fi', servers: ['1.1.1.1'] })
              }
            ],
            warnings: []
          }
        }
        return {
          finishReason: 'stop' as const,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          content: [{ type: 'text' as const, text: '已把 DNS 改好。' }],
          warnings: []
        }
      }
    })

    // 不注入 tools → 用默认工具集（含 set_dns_servers），但注入 mock shell 避免真实改动
    const result = await runAgent('帮我把 DNS 改成 1.1.1.1', {
      model,
      shell: async () => ({ code: 0, stdout: '', stderr: '' })
    })

    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({ riskLevel: 'reversible' })
    expect(result.changes[0].description).toMatch(/DNS/)
  })
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: FAIL —— `runAgent` 不接受 `shell` 选项 / `result.changes` 为 undefined。

- [ ] **Step 3: 改 `packages/core/src/run-agent.ts`**

把顶部 import、`RunAgentDeps`、`AgentResult`、函数体替换为下面内容（其余如 `ChatMessage`、`SYSTEM_PROMPT` 保留）：

import 区加入：

```ts
import { ChangeLog, type ChangeSummary } from './safety/change-log.js'
import { createNetworkFixTools } from './tools/network-fix.js'
```

`RunAgentDeps` 与 `AgentResult` 改为：

```ts
export interface RunAgentDeps {
  model?: LanguageModel
  tools?: ToolSet
  /** 注入 shell（测试用 mock，避免真实系统改动）；不传则用 runReadOnly。 */
  shell?: ShellRunner
}

export interface AgentResult {
  text: string
  toolCalls: Array<{ toolName: string; input: unknown }>
  changes: ChangeSummary[]
}
```

并在文件顶部已有 import 中补 `ShellRunner` 类型（与 `runReadOnly` 同源）：把
`import { runReadOnly } from './shell.js'`
改为
`import { runReadOnly, type ShellRunner } from './shell.js'`

函数体改为：

```ts
export async function runAgent(input: string | ChatMessage[], deps: RunAgentDeps = {}): Promise<AgentResult> {
  const model = deps.model ?? getModel()
  const shell = deps.shell ?? runReadOnly
  const changeLog = new ChangeLog()
  const tools =
    deps.tools ??
    {
      ...createNetworkTools(shell),
      ...createNetworkFixTools({ shell, changeLog })
    }

  const result = await generateText({
    model,
    tools,
    system: SYSTEM_PROMPT,
    ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
    stopWhen: stepCountIs(5)
  })

  const allToolCalls = result.steps.flatMap((s) => s.toolCalls)

  return {
    text: result.text,
    toolCalls: allToolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
    changes: changeLog.list()
  }
}
```

并把 `SYSTEM_PROMPT` 内容更新为允许"可逆修复"（替换原常量）：

```ts
const SYSTEM_PROMPT = `你是 OpenFix，帮普通人排查并修复电脑网络问题的助手。
先用只读工具查清情况；确有必要时可调用"可逆"修复工具（如改 DNS）——这类改动会自动记录、可一键还原。
不要执行没把握的或不可逆的破坏性操作。最后用简短的大白话告诉用户你查到/改了什么。`
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: PASS（4 用例：原 3 + 新 1）。

- [ ] **Step 5: 导出新类型 —— 改 `packages/core/src/index.ts`，整文件为：**

```ts
export { runAgent } from './run-agent.js'
export type { AgentResult, RunAgentDeps, ChatMessage } from './run-agent.js'
export type { ShellResult, ShellRunner } from './shell.js'
export type { ChangeSummary, RiskLevel } from './safety/change-log.js'
```

- [ ] **Step 6: 全量测试 + 构建 + typecheck**

Run: `pnpm --filter @openfix/core test && pnpm --filter @openfix/core typecheck && pnpm --filter @openfix/core build`
Expected: 全部 PASS / 无错；`dist/` 更新。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/run-agent.ts packages/core/src/run-agent.test.ts packages/core/src/index.ts
git commit -m "feat(core): runAgent 接入 ChangeLog，结果带 changes，并启用可逆修复工具"
```

---

## Self-Review（对照 spec）

**1. Spec 覆盖（安全模型那节）：**
- "改动前自动快照" → `createWriteTool` 先 `snapshot` 再 `apply`（Task 2/3）✅
- "可逆写操作自动做（但先快照）" → reversible 直接执行并记账（Task 2）✅
- "不可逆操作才硬确认" → irreversible 无 `confirm` 即拒绝、有 `confirm` 才执行（Task 2）✅
- "写操作工具必须自声明可逆性/如何快照/如何回滚/风险等级" → `WriteToolSpec` 强制这些字段（Task 2）✅
- "可回滚" → `ChangeLog.rollbackAll` LIFO 回滚（Task 1）✅
- **本计划不覆盖（留后续）**：失败自动复测+自动回滚（2b）；GUI 的"我改了啥/一键还原"与不可逆硬确认弹窗（2c）。已在抬头声明。

**2. 占位符扫描：** 无 TBD/TODO；每个代码步骤含完整代码；每个命令步骤含预期。✅

**3. 类型一致性：** `RiskLevel`/`ChangeSummary`/`ChangeEntry`（change-log）被 write-tool、network-fix、run-agent、index 一致引用；`WriteToolContext{shell,changeLog,confirm?}` 在 write-tool 定义、network-fix 接收、run-agent 构造三处一致；`createNetworkFixTools(ctx)` 返回 `ToolSet`，被 run-agent 默认工具合并；`AgentResult.changes: ChangeSummary[]` 在 run-agent 定义、其测试断言、index 导出一致；`RunAgentDeps.shell` 新增项在 run-agent 与 Task4 测试一致。✅

**已知外部不确定性（执行时留意）：**
- `networksetup -getdnsservers` 的"无 DNS"提示文案以实际系统为准；解析用正则 `/aren't any|there aren't/i`，必要时按真实输出微调（仅影响回滚走 Empty 的判断；单测已覆盖两种分支）。
- 真实改 DNS 在部分 macOS 上可能需要管理员；本计划不做真实写 smoke，留到 2c。
