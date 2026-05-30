# OpenFix Plan 4a：不可逆写（核心）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让引擎支持"不可逆写操作"——必须用户确认才执行、执行后只记录不参与回滚；可逆/不可逆在 `ChangeLog` 与自动回滚策略里彻底分开。落第一个不可逆工具 `empty_trash`（清空废纸篓）。

**Architecture:** `ChangeLog` 增加 `rollbackReversible()`（只回滚可逆项、保留不可逆记录）；`createWriteTool` 区分风险——不可逆走 `ctx.confirm` 闸（未授权拒绝）、执行后记 no-op rollback；`SkillContext` 增加 `confirm`，`runAgent` 把 `deps.confirm` 串进去，并把自动回滚策略改成"只对可逆改动 + 复测未过"触发。`empty_trash` 用 macOS Finder 安全清空。**全程 mock shell + mock confirm，不删真实文件。**

**Tech Stack:** TypeScript · Vercel AI SDK · zod · Vitest · macOS `osascript`/Finder。

> **范围（No silent caps）：** 只做 core。**不含** GUI 确认弹窗与双向 IPC、一键还原面板按可逆过滤（Plan 4b）。在 4b 接上 GUI 前，不可逆工具因 `confirm` 缺省会被拒绝执行——这是安全的（绝不静默删东西）。

---

## File Structure

```
packages/core/src/
├── safety/
│   ├── change-log.ts        # 加 rollbackReversible（修改）
│   ├── change-log.test.ts   # 加用例（修改）
│   ├── write-tool.ts        # 区分可逆/不可逆；snapshot/rollback 变可选（修改）
│   └── write-tool.test.ts   # 加用例（修改）
├── skills/
│   ├── skill-pack.ts        # SkillContext 加 confirm?（修改）
│   ├── network-pack.ts      # 传 confirm 给 fix 工具（修改）
│   ├── system-pack.ts       # 并入 system-fix 工具（修改）
│   └── system-pack.test.ts  # 加用例（修改）
├── tools/
│   ├── system-fix.ts        # empty_trash 不可逆写工具（新建）
│   └── system-fix.test.ts
├── run-agent.ts             # confirm 串通 + 自动回滚只针对可逆（修改）
├── run-agent.test.ts        # 加用例（修改）
└── index.ts                 # 无需改（类型已导出）
```

---

## Task 1: ChangeLog.rollbackReversible（TDD）

**Files:**
- Modify: `packages/core/src/safety/change-log.ts`
- Modify: `packages/core/src/safety/change-log.test.ts`

- [ ] **Step 1: 在 `change-log.test.ts` 末尾 describe 内加用例**

```ts
  it('rollbackReversible 只回滚可逆项，保留不可逆记录', async () => {
    const log = new ChangeLog()
    const order: string[] = []
    log.record({ description: 'rev', riskLevel: 'reversible', rollback: async () => void order.push('rev') })
    log.record({ description: 'irr', riskLevel: 'irreversible', rollback: async () => void order.push('irr') })
    await log.rollbackReversible()
    expect(order).toEqual(['rev']) // 只回滚可逆
    expect(log.list().map((c) => c.riskLevel)).toEqual(['irreversible']) // 不可逆记录保留
  })
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/safety/change-log.test.ts`
Expected: FAIL —— `rollbackReversible` 未定义。

- [ ] **Step 3: 在 `change-log.ts` 的 `ChangeLog` 类里，`rollbackAll` 之后加方法**

```ts
  /** 只回滚"可逆"改动（LIFO），并移除它们；不可逆记录保留（无法撤销）。 */
  async rollbackReversible(): Promise<void> {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].riskLevel === 'reversible') await this.entries[i].rollback()
    }
    this.entries = this.entries.filter((e) => e.riskLevel !== 'reversible')
  }
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/safety/change-log.test.ts`
Expected: PASS（原 2 + 新 1 = 3 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/safety/change-log.ts packages/core/src/safety/change-log.test.ts
git commit -m "feat(core): ChangeLog.rollbackReversible 只回滚可逆项"
```

---

## Task 2: createWriteTool 区分可逆/不可逆（TDD）

**Files:**
- Modify: `packages/core/src/safety/write-tool.ts`
- Modify: `packages/core/src/safety/write-tool.test.ts`

- [ ] **Step 1: 在 `write-tool.test.ts` 末尾 describe 内加用例**

```ts
  it('不可逆写：记账 riskLevel=irreversible 且其回滚为 no-op（不调用 spec.rollback）', async () => {
    let specRollbackCalled = false
    const ctx = makeCtx({ confirm: async () => true })
    const t = createWriteTool(
      { ...spec, riskLevel: 'irreversible', rollback: async () => void (specRollbackCalled = true) },
      ctx
    )
    await t.execute!({ value: 'X' }, okOptions)
    expect(ctx.changeLog.list()[0].riskLevel).toBe('irreversible')
    await ctx.changeLog.rollbackAll()
    expect(specRollbackCalled).toBe(false)
  })
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/safety/write-tool.test.ts`
Expected: FAIL —— 当前不可逆也会绑定 `spec.rollback`，`specRollbackCalled` 变 true。

- [ ] **Step 3: 改 `write-tool.ts`**

把 `WriteToolSpec` 的 `snapshot`/`rollback` 改为可选：

```ts
  snapshot?: (input: z.infer<S>, shell: ShellRunner) => Promise<unknown>
  apply: (input: z.infer<S>, shell: ShellRunner) => Promise<string>
  rollback?: (snapshot: unknown, input: z.infer<S>, shell: ShellRunner) => Promise<void>
```

把 `execute` 整体替换为：

```ts
    execute: async (input: z.infer<S>) => {
      const desc = spec.describe(input)
      if (spec.riskLevel === 'irreversible') {
        const ok = ctx.confirm ? await ctx.confirm(desc) : false
        if (!ok) return `已拒绝执行（不可逆操作需用户确认，未获授权）：${desc}`
        const result = await spec.apply(input, ctx.shell)
        // 不可逆：记录用于透明展示，但回滚是 no-op（撤不回）
        ctx.changeLog.record({ description: desc, riskLevel: 'irreversible', rollback: async () => {} })
        return result
      }
      const snap = spec.snapshot ? await spec.snapshot(input, ctx.shell) : undefined
      const result = await spec.apply(input, ctx.shell)
      ctx.changeLog.record({
        description: desc,
        riskLevel: 'reversible',
        rollback: () => (spec.rollback ? spec.rollback(snap, input, ctx.shell) : Promise.resolve())
      })
      return result
    }
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/safety/write-tool.test.ts`
Expected: PASS（原 4 + 新 1 = 5 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/safety/write-tool.ts packages/core/src/safety/write-tool.test.ts
git commit -m "feat(core): createWriteTool 区分可逆/不可逆（snapshot/rollback 可选）"
```

---

## Task 3: empty_trash 不可逆工具 + SkillContext.confirm + 并入 system 包（TDD）

**Files:**
- Modify: `packages/core/src/skills/skill-pack.ts`
- Create: `packages/core/src/tools/system-fix.ts`
- Create: `packages/core/src/tools/system-fix.test.ts`
- Modify: `packages/core/src/skills/system-pack.ts`
- Modify: `packages/core/src/skills/system-pack.test.ts`
- Modify: `packages/core/src/skills/network-pack.ts`

- [ ] **Step 1: `skill-pack.ts` 的 `SkillContext` 加 confirm**

```ts
export interface SkillContext {
  shell: ShellRunner
  changeLog: ChangeLog
  verification: Verification
  confirm?: (description: string) => Promise<boolean>
}
```

- [ ] **Step 2: 写失败测试 `packages/core/src/tools/system-fix.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { ChangeLog } from '../safety/change-log'
import { createSystemFixTools } from './system-fix'

const okOptions = { toolCallId: 't1', messages: [] } as never

describe('empty_trash', () => {
  it('已授权：调 Finder 清空并记一条不可逆改动', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '))
      return { code: 0, stdout: '', stderr: '' }
    }
    const changeLog = new ChangeLog()
    const tools = createSystemFixTools({ shell, changeLog, confirm: async () => true })
    const out = (await tools.empty_trash.execute!({}, okOptions)) as string
    expect(out).toMatch(/废纸篓/)
    expect(calls.some((c) => c.includes('Finder') && c.includes('empty trash'))).toBe(true)
    expect(changeLog.list()).toEqual([
      { id: 1, description: expect.stringMatching(/废纸篓/), riskLevel: 'irreversible' }
    ])
  })

  it('未授权（confirm 缺省）：拒绝，不调 shell、不记账', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '))
      return { code: 0, stdout: '', stderr: '' }
    }
    const changeLog = new ChangeLog()
    const tools = createSystemFixTools({ shell, changeLog })
    const out = (await tools.empty_trash.execute!({}, okOptions)) as string
    expect(out).toMatch(/拒绝|未获授权/)
    expect(calls).toEqual([])
    expect(changeLog.list()).toEqual([])
  })
})
```

- [ ] **Step 3: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/tools/system-fix.test.ts`
Expected: FAIL —— 找不到 `./system-fix`。

- [ ] **Step 4: 实现 `packages/core/src/tools/system-fix.ts`**

```ts
import { z } from 'zod'
import type { ToolSet } from 'ai'
import { createWriteTool, type WriteToolContext } from '../safety/write-tool.js'

/** 软件/系统域不可逆写工具（需用户确认）。 */
export function createSystemFixTools(ctx: WriteToolContext): ToolSet {
  return {
    empty_trash: createWriteTool(
      {
        description: '清空废纸篓以释放磁盘空间（不可逆，需用户确认）。',
        inputSchema: z.object({}),
        riskLevel: 'irreversible',
        describe: () => '清空废纸篓（不可撤销）',
        apply: async (_input, shell) => {
          await shell('osascript', ['-e', 'tell application "Finder" to empty trash'])
          return '已清空废纸篓。'
        }
      },
      ctx
    )
  }
}
```

- [ ] **Step 5: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/tools/system-fix.test.ts`
Expected: PASS（2 用例）。

- [ ] **Step 6: 把 empty_trash 并入 systemSkillPack —— 改 `system-pack.ts`**

```ts
import type { SkillPack } from './skill-pack.js'
import { createSystemTools } from '../tools/system.js'
import { createSystemFixTools } from '../tools/system-fix.js'

/** 软件/系统域技能包（只读诊断 + 不可逆清理）。 */
export const systemSkillPack: SkillPack = {
  name: 'system',
  createTools: (ctx) => ({
    ...createSystemTools(ctx.shell),
    ...createSystemFixTools({ shell: ctx.shell, changeLog: ctx.changeLog, confirm: ctx.confirm })
  }),
  systemPrompt: `【软件/系统域】只读诊断：check_disk_space（磁盘占用）、check_app_installed（软件是否安装）。可逆/不可逆修复：empty_trash（清空废纸篓，不可撤销，需用户确认）。`
}
```

- [ ] **Step 7: 更新 `system-pack.test.ts` 的工具清单断言**

```ts
    expect(Object.keys(tools).sort()).toEqual([
      'check_app_installed',
      'check_disk_space',
      'empty_trash'
    ])
```

- [ ] **Step 8: 让 networkSkillPack 也把 confirm 透传（前向兼容，便于以后网络域加不可逆工具）—— 改 `network-pack.ts` 的 fix 工具构造**

```ts
    ...createNetworkFixTools({ shell: ctx.shell, changeLog: ctx.changeLog, confirm: ctx.confirm }),
```

- [ ] **Step 9: 运行系统包测试，确认通过**

Run: `pnpm --filter @openfix/core test src/skills/system-pack.test.ts`
Expected: PASS（1 用例，工具清单 3 个）。

- [ ] **Step 10: 提交**

```bash
git add packages/core/src/skills/skill-pack.ts packages/core/src/tools/system-fix.ts packages/core/src/tools/system-fix.test.ts packages/core/src/skills/system-pack.ts packages/core/src/skills/system-pack.test.ts packages/core/src/skills/network-pack.ts
git commit -m "feat(core): empty_trash 不可逆工具 + SkillContext.confirm 透传"
```

---

## Task 4: runAgent 串通 confirm + 自动回滚只针对可逆（TDD）

**Files:**
- Modify: `packages/core/src/run-agent.ts`
- Modify: `packages/core/src/run-agent.test.ts`

- [ ] **Step 1: 在 `run-agent.test.ts` 末尾加两个用例**

```ts
  it('confirm 通过：不可逆工具执行、记一条 irreversible，且不被自动回滚', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]) => {
      calls.push(cmd)
      return { code: 0, stdout: '', stderr: '' }
    }
    const model = scripted([{ tool: { name: 'empty_trash', input: {} } }, { text: '已清空。' }])
    const result = await runAgent('帮我清下废纸篓', { model, shell, confirm: async () => true })
    expect(calls).toContain('osascript')
    expect(result.changes).toEqual([
      { id: 1, description: expect.stringMatching(/废纸篓/), riskLevel: 'irreversible' }
    ])
    expect(result.rolledBack).toBe(false) // 不可逆不参与自动回滚
  })

  it('confirm 缺省：不可逆工具被拒绝，不执行、无改动', async () => {
    const calls: string[] = []
    const shell = async (cmd: string) => {
      calls.push(cmd)
      return { code: 0, stdout: '', stderr: '' }
    }
    const model = scripted([{ tool: { name: 'empty_trash', input: {} } }, { text: '没清。' }])
    const result = await runAgent('帮我清下废纸篓', { model, shell })
    expect(calls).not.toContain('osascript')
    expect(result.changes).toEqual([])
    expect(result.rolledBack).toBe(false)
  })
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: FAIL —— `runAgent` 不接受 `confirm`，confirm 没串到工具，`empty_trash` 被拒绝（第一个用例 `osascript` 不会被调用）。

- [ ] **Step 3: 改 `run-agent.ts`**

`RunAgentDeps` 加：

```ts
  /** 不可逆操作的确认回调；不传则不可逆工具一律拒绝。 */
  confirm?: (description: string) => Promise<boolean>
```

构造 `skillContext` 处加入 confirm：

```ts
  const skillContext: SkillContext = { shell, changeLog, verification, confirm: deps.confirm }
```

把收尾的自动回滚策略改成只针对可逆改动：

```ts
  const allToolCalls = result.steps.flatMap((s) => s.toolCalls)
  const applied = changeLog.list()

  // 收尾安全策略：有"可逆"改动但复测没通过（或没复测）→ 自动还原可逆项
  const reversibleApplied = applied.filter((c) => c.riskLevel === 'reversible')
  let rolledBack = false
  if (reversibleApplied.length > 0 && verification.passed !== true) {
    await changeLog.rollbackReversible()
    rolledBack = true
  }
```

（其余 `text`/`return` 不变；`return` 仍用 `changes: applied`。）

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: PASS（原 9 + 新 2 = 11 用例）。

- [ ] **Step 5: 全量测试 + typecheck + build**

Run: `pnpm --filter @openfix/core test && pnpm --filter @openfix/core typecheck && pnpm --filter @openfix/core build`
Expected: 全 PASS / 无错。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/run-agent.ts packages/core/src/run-agent.test.ts
git commit -m "feat(core): runAgent 串通 confirm，自动回滚只针对可逆改动"
```

---

## Self-Review（对照 spec）

**1. Spec 覆盖（安全模型）：**
- "不可逆操作才硬确认" → createWriteTool 不可逆走 `ctx.confirm`，缺省拒绝（Task 2），runAgent 串 confirm（Task 4）✅
- "写工具自声明可逆性" → `riskLevel` 必填，可逆才需 snapshot/rollback（Task 2）✅
- "不可逆操作绝不静默执行" → 无 confirm 即拒绝、不调 shell、不记账（Task 3 第二个用例）✅
- "可回滚只对可逆" → `rollbackReversible` + 自动回滚仅可逆（Task 1/4）✅
- **不覆盖（4b）**：GUI 确认弹窗 + 双向 IPC + 一键还原面板按可逆过滤。在 4b 前，缺 confirm 时不可逆工具被安全拒绝。

**2. 占位符扫描：** 无 TBD/TODO；代码与命令完整。✅

**3. 类型一致性：** `RiskLevel`/`ChangeLog.rollbackReversible` 在 change-log 定义，被 run-agent 用；`WriteToolContext.confirm?` 在 write-tool 定义，被 system-fix/network-pack/system-pack 传入，源头 `SkillContext.confirm?`（skill-pack）→ runAgent `deps.confirm`；`createSystemFixTools(ctx)` 返回 `ToolSet`，并入 systemSkillPack；`empty_trash` 记账 `riskLevel:'irreversible'` 与测试断言一致。✅

**已知不确定性：** `empty_trash` 用 `osascript` 让 Finder 清空（macOS 安全标准做法）；真实执行属 4b 端到端（本计划仅 mock）。
