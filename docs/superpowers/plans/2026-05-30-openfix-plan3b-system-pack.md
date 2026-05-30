# OpenFix Plan 3b：软件/系统包 B（只读诊断）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加第一个新领域技能包——`systemSkillPack`（软件/系统域），首批两个只读诊断工具（磁盘占用、软件是否安装），并接入 `runAgent` 默认包列表，验证"多包共存、加包就扩域，引擎不动"。

**Architecture:** 沿用 Plan 3a 的 `SkillPack` 机制：`core/src/tools/system.ts` 提供 `createSystemTools(shell)`（两个只读工具），`core/src/skills/system-pack.ts` 包成 `systemSkillPack`，`runAgent` 默认包列表从 `[networkSkillPack]` 变为 `[networkSkillPack, systemSkillPack]`。全程 mock shell。

**Tech Stack:** TypeScript · Vercel AI SDK · zod · Vitest · macOS `df` / `ls`。

> **范围（No silent caps）：** 仅软件/系统域的**只读诊断**（磁盘、软件安装查询）。**不含**该域的写操作（清理/卸载等更危险，后续单独排）、不含独立拆包。

---

## File Structure

```
packages/core/src/
├── tools/
│   ├── system.ts            # createSystemTools：check_disk_space + check_app_installed（新建）
│   └── system.test.ts
├── skills/
│   ├── system-pack.ts       # systemSkillPack（新建）
│   └── system-pack.test.ts
├── run-agent.ts             # 默认包列表加 systemSkillPack（修改）
├── run-agent.test.ts        # 加：默认可调用 check_disk_space（修改）
└── index.ts                 # 导出 systemSkillPack（修改）
```

---

## Task 1: createSystemTools 只读系统工具（TDD）

**Files:**
- Create: `packages/core/src/tools/system.ts`
- Test: `packages/core/src/tools/system.test.ts`

- [ ] **Step 1: 写失败测试 `packages/core/src/tools/system.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import type { ShellResult } from '../shell'
import { createSystemTools } from './system'

const okOptions = { toolCallId: 't1', messages: [] } as never

function shellReturning(map: Record<string, string>): (c: string, a: string[]) => Promise<ShellResult> {
  return async (cmd) => ({ code: 0, stdout: map[cmd] ?? '', stderr: '' })
}

describe('check_disk_space', () => {
  it('解析 df -h 根分区的 size/used/avail/percent', async () => {
    const df = 'Filesystem Size Used Avail Capacity Mounted\n/dev/disk3 926Gi 10Gi 300Gi 4% /'
    const tools = createSystemTools(shellReturning({ df }))
    const res = await tools.check_disk_space.execute!({}, okOptions)
    expect(res).toMatchObject({ size: '926Gi', used: '10Gi', available: '300Gi', usedPercent: '4%' })
  })
})

describe('check_app_installed', () => {
  it('在 /Applications 里大小写不敏感匹配 → installed=true', async () => {
    const ls = 'Google Chrome.app\nSafari.app\n微信.app'
    const tools = createSystemTools(shellReturning({ ls }))
    const res = await tools.check_app_installed.execute!({ name: 'chrome' }, okOptions)
    expect(res).toMatchObject({ name: 'chrome', installed: true, matches: ['Google Chrome.app'] })
  })

  it('找不到 → installed=false、matches 为空', async () => {
    const ls = 'Safari.app\n微信.app'
    const tools = createSystemTools(shellReturning({ ls }))
    const res = await tools.check_app_installed.execute!({ name: 'Firefox' }, okOptions)
    expect(res).toMatchObject({ name: 'Firefox', installed: false, matches: [] })
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/tools/system.test.ts`
Expected: FAIL —— 找不到 `./system`。

- [ ] **Step 3: 实现 `packages/core/src/tools/system.ts`**

```ts
import { z } from 'zod'
import { tool, type ToolSet } from 'ai'
import type { ShellRunner } from '../shell.js'

/** 软件/系统域只读诊断工具集。 */
export function createSystemTools(shell: ShellRunner): ToolSet {
  return {
    check_disk_space: tool({
      description: '查看主磁盘（根分区）的占用情况（只读）。',
      inputSchema: z.object({}),
      execute: async () => {
        const r = await shell('df', ['-h', '/'])
        const lines = r.stdout.trim().split('\n')
        const data = lines[lines.length - 1].trim().split(/\s+/)
        // macOS df -h 数据行：[Filesystem, Size, Used, Avail, Capacity, ...]
        return {
          size: data[1] ?? null,
          used: data[2] ?? null,
          available: data[3] ?? null,
          usedPercent: data[4] ?? null,
          raw: r.stdout.trim()
        }
      }
    }),
    check_app_installed: tool({
      description: '检查某个图形软件是否已安装（查 /Applications，只读）。',
      inputSchema: z.object({ name: z.string().describe('软件名，如 Chrome、微信') }),
      execute: async ({ name }) => {
        const r = await shell('ls', ['/Applications'])
        const apps = r.stdout
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
        const matches = apps.filter((a) => a.toLowerCase().includes(name.toLowerCase()))
        return { name, installed: matches.length > 0, matches }
      }
    })
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/tools/system.test.ts`
Expected: PASS（3 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/tools/system.ts packages/core/src/tools/system.test.ts
git commit -m "feat(core): 软件/系统域只读工具 check_disk_space / check_app_installed"
```

---

## Task 2: systemSkillPack + 接入默认包列表（TDD）

**Files:**
- Create: `packages/core/src/skills/system-pack.ts`
- Test: `packages/core/src/skills/system-pack.test.ts`
- Modify: `packages/core/src/run-agent.ts`
- Modify: `packages/core/src/run-agent.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 写失败测试 `packages/core/src/skills/system-pack.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { systemSkillPack } from './system-pack'
import { ChangeLog } from '../safety/change-log'
import { Verification } from '../safety/verification'

describe('systemSkillPack', () => {
  it('提供 check_disk_space / check_app_installed 两个工具', () => {
    const tools = systemSkillPack.createTools({
      shell: async () => ({ code: 0, stdout: '', stderr: '' }),
      changeLog: new ChangeLog(),
      verification: new Verification()
    })
    expect(Object.keys(tools).sort()).toEqual(['check_app_installed', 'check_disk_space'])
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/skills/system-pack.test.ts`
Expected: FAIL —— 找不到 `./system-pack`。

- [ ] **Step 3: 实现 `packages/core/src/skills/system-pack.ts`**

```ts
import type { SkillPack } from './skill-pack.js'
import { createSystemTools } from '../tools/system.js'

/** 软件/系统域技能包（首批只读诊断）。 */
export const systemSkillPack: SkillPack = {
  name: 'system',
  createTools: (ctx) => createSystemTools(ctx.shell),
  systemPrompt: `【软件/系统域】只读诊断工具：check_disk_space（磁盘占用）、check_app_installed（某图形软件是否安装）。`
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/skills/system-pack.test.ts`
Expected: PASS（1 用例）。

- [ ] **Step 5: 在 `run-agent.test.ts` 末尾（最后一个 `})` 前）加用例：默认包含系统包**

```ts
  it('默认包含软件/系统包：可调用 check_disk_space', async () => {
    const df = 'Filesystem Size Used Avail Capacity Mounted\n/dev/disk3 926Gi 10Gi 300Gi 4% /'
    const shell = async (cmd: string) => ({
      code: 0,
      stdout: cmd === 'df' ? df : '',
      stderr: ''
    })
    const model = scripted([
      { tool: { name: 'check_disk_space', input: {} } },
      { text: '磁盘还够用。' }
    ])
    const result = await runAgent('电脑有点卡', { model, shell })
    expect(result.toolCalls.map((c) => c.toolName)).toContain('check_disk_space')
  })
```

- [ ] **Step 6: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: FAIL —— 默认包仅 `[networkSkillPack]`，`check_disk_space` 不在工具集。

- [ ] **Step 7: 改 `packages/core/src/run-agent.ts`**

import 区加：

```ts
import { systemSkillPack } from './skills/system-pack.js'
```

把默认包列表那行：

```ts
  const packs = deps.skillPacks ?? [networkSkillPack]
```

改为：

```ts
  const packs = deps.skillPacks ?? [networkSkillPack, systemSkillPack]
```

- [ ] **Step 8: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: PASS（原 8 + 新 1 = 9 用例）。

- [ ] **Step 9: 导出 systemSkillPack —— 在 `packages/core/src/index.ts` 末尾追加**

```ts
export { systemSkillPack } from './skills/system-pack.js'
```

- [ ] **Step 10: 全量测试 + typecheck + build**

Run: `pnpm --filter @openfix/core test && pnpm --filter @openfix/core typecheck && pnpm --filter @openfix/core build`
Expected: 全 PASS / 无错。

- [ ] **Step 11: 提交**

```bash
git add packages/core/src/skills/system-pack.ts packages/core/src/skills/system-pack.test.ts packages/core/src/run-agent.ts packages/core/src/run-agent.test.ts packages/core/src/index.ts
git commit -m "feat(core): systemSkillPack 软件/系统域包并接入默认包列表"
```

---

## Self-Review（对照 spec）

**1. Spec 覆盖：**
- "加包就扩域、引擎不动" → 仅新增 system 工具/包 + 默认列表加一项，runAgent 逻辑零改（Task 2）✅
- "多包共存" → 默认 `[networkSkillPack, systemSkillPack]`，composeTools 合并（Task 2）✅
- "软件/系统包(B)" 起步（只读）→ check_disk_space / check_app_installed（Task 1）✅
- **不覆盖（后续）**：系统域写操作（清理/卸载）、独立拆包、GUI 针对系统域的特化。

**2. 占位符扫描：** 无 TBD/TODO；代码与命令完整。✅

**3. 类型一致性：** `createSystemTools(shell)` 返回 `ToolSet`，被 system-pack 用 `ctx.shell` 调用；`systemSkillPack` 符合 `SkillPack`；run-agent 默认列表与 index 导出一致；测试里 df 数据行字段位置（[1]=Size…[4]=Capacity）与实现解析一致。✅

**已知不确定性：** `check_app_installed` 仅查 `/Applications`（GUI 软件），命令行工具不在其中——v1 限制，可接受；后续可扩 `~/Applications` 与 `which`。
