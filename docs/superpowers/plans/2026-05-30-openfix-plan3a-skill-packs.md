# OpenFix Plan 3a：可插拔技能包机制 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"内核 + 可插拔技能包"落地——定义 `SkillPack` 接口（每包贡献工具 + 系统提示），把现有网络工具包成 `networkSkillPack`，`runAgent` 改为"组合技能包"驱动。之后新增一个域只需写一个新包、不改引擎。

**Architecture:** `core/src/skills/` 加 `skill-pack.ts`（`SkillPack`/`SkillContext` 接口 + `composeTools`/`composeSystemPrompts`）与 `network-pack.ts`（包装 network/network-fix/network-verify 三组工具）。`runAgent` 用 `SkillContext{shell,changeLog,verification}` 调各包 `createTools`，合并工具与系统提示；默认包列表 `[networkSkillPack]`，可经 `deps.skillPacks` 覆盖。技能包暂作 core 内模块（不单独拆 npm 包）。

**Tech Stack:** TypeScript · Vercel AI SDK · zod · Vitest。

> **范围（No silent caps）：** 只立抽象 + 网络包 + runAgent 组合。**不含**软件/系统包 B（Plan 3b）、不含把包拆成独立 `packages/skill-network`（按 YAGNI 暂留 core 内）。`tools/network*.ts` 文件保持原位，仅由 network-pack 包装引用。

---

## File Structure

```
packages/core/src/
├── skills/
│   ├── skill-pack.ts        # SkillPack/SkillContext + composeTools/composeSystemPrompts（新建）
│   ├── skill-pack.test.ts
│   ├── network-pack.ts      # networkSkillPack（包装现有网络工具）（新建）
│   └── network-pack.test.ts
├── run-agent.ts             # 改为组合技能包驱动（修改）
├── run-agent.test.ts        # 加：注入 skillPacks（修改）
└── index.ts                 # 导出 SkillPack/SkillContext/networkSkillPack（修改）
```

---

## Task 1: SkillPack 接口 + 组合函数（TDD）

**Files:**
- Create: `packages/core/src/skills/skill-pack.ts`
- Test: `packages/core/src/skills/skill-pack.test.ts`

- [ ] **Step 1: 写失败测试 `packages/core/src/skills/skill-pack.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { tool } from 'ai'
import { z } from 'zod'
import { composeTools, composeSystemPrompts, type SkillPack, type SkillContext } from './skill-pack'
import { ChangeLog } from '../safety/change-log'
import { Verification } from '../safety/verification'

const ctx: SkillContext = {
  shell: async () => ({ code: 0, stdout: '', stderr: '' }),
  changeLog: new ChangeLog(),
  verification: new Verification()
}

function fakePack(name: string, toolName: string, prompt?: string): SkillPack {
  return {
    name,
    createTools: () => ({
      [toolName]: tool({ description: name, inputSchema: z.object({}), execute: async () => 'ok' })
    }),
    systemPrompt: prompt
  }
}

describe('skill-pack', () => {
  it('composeTools 合并各包工具', () => {
    const tools = composeTools([fakePack('a', 'tool_a'), fakePack('b', 'tool_b')], ctx)
    expect(Object.keys(tools).sort()).toEqual(['tool_a', 'tool_b'])
  })

  it('composeSystemPrompts 只拼接非空片段，用空行分隔', () => {
    const s = composeSystemPrompts([
      fakePack('a', 't_a', 'AAA'),
      fakePack('b', 't_b'),
      fakePack('c', 't_c', 'CCC')
    ])
    expect(s).toBe('AAA\n\nCCC')
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/skills/skill-pack.test.ts`
Expected: FAIL —— 找不到 `./skill-pack`。

- [ ] **Step 3: 实现 `packages/core/src/skills/skill-pack.ts`**

```ts
import type { ToolSet } from 'ai'
import type { ShellRunner } from '../shell.js'
import type { ChangeLog } from '../safety/change-log.js'
import type { Verification } from '../safety/verification.js'

/** 运行时注入给技能包的上下文。 */
export interface SkillContext {
  shell: ShellRunner
  changeLog: ChangeLog
  verification: Verification
}

/** 一个诊断/修复技能包：贡献工具 + 一段（可选）系统提示指导。 */
export interface SkillPack {
  name: string
  createTools: (ctx: SkillContext) => ToolSet
  systemPrompt?: string
}

/** 把多个技能包的工具合并成一个 ToolSet。 */
export function composeTools(packs: SkillPack[], ctx: SkillContext): ToolSet {
  return packs.reduce<ToolSet>((acc, p) => ({ ...acc, ...p.createTools(ctx) }), {})
}

/** 收集各包的非空系统提示片段，用空行拼接。 */
export function composeSystemPrompts(packs: SkillPack[]): string {
  return packs
    .map((p) => p.systemPrompt?.trim())
    .filter((s): s is string => Boolean(s))
    .join('\n\n')
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/skills/skill-pack.test.ts`
Expected: PASS（2 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/skills/skill-pack.ts packages/core/src/skills/skill-pack.test.ts
git commit -m "feat(core): SkillPack 技能包接口 + composeTools/composeSystemPrompts"
```

---

## Task 2: networkSkillPack（包装现有网络工具）（TDD）

**Files:**
- Create: `packages/core/src/skills/network-pack.ts`
- Test: `packages/core/src/skills/network-pack.test.ts`

- [ ] **Step 1: 写失败测试 `packages/core/src/skills/network-pack.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { networkSkillPack } from './network-pack'
import { ChangeLog } from '../safety/change-log'
import { Verification } from '../safety/verification'

describe('networkSkillPack', () => {
  it('提供 check_connectivity / set_dns_servers / verify_connectivity 三个工具', () => {
    const tools = networkSkillPack.createTools({
      shell: async () => ({ code: 0, stdout: '', stderr: '' }),
      changeLog: new ChangeLog(),
      verification: new Verification()
    })
    expect(Object.keys(tools).sort()).toEqual([
      'check_connectivity',
      'set_dns_servers',
      'verify_connectivity'
    ])
  })

  it('带网络域的系统提示（含复测要求）', () => {
    expect(networkSkillPack.systemPrompt).toMatch(/verify_connectivity/)
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/skills/network-pack.test.ts`
Expected: FAIL —— 找不到 `./network-pack`。

- [ ] **Step 3: 实现 `packages/core/src/skills/network-pack.ts`**

```ts
import type { SkillPack } from './skill-pack.js'
import { createNetworkTools } from '../tools/network.js'
import { createNetworkFixTools } from '../tools/network-fix.js'
import { createNetworkVerifyTools } from '../tools/network-verify.js'

/** 网络域技能包：只读诊断 + 可逆改 DNS + 复测。 */
export const networkSkillPack: SkillPack = {
  name: 'network',
  createTools: (ctx) => ({
    ...createNetworkTools(ctx.shell),
    ...createNetworkFixTools({ shell: ctx.shell, changeLog: ctx.changeLog }),
    ...createNetworkVerifyTools(ctx.shell, ctx.verification)
  }),
  systemPrompt: `【网络域】工具：check_connectivity（只读测连通）、set_dns_servers（可逆改 DNS）、verify_connectivity（修复后复测）。任何修复后必须调用 verify_connectivity 复测，只有复测通过才算修好。`
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/skills/network-pack.test.ts`
Expected: PASS（2 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/skills/network-pack.ts packages/core/src/skills/network-pack.test.ts
git commit -m "feat(core): networkSkillPack 包装网络域工具"
```

---

## Task 3: runAgent 改为组合技能包驱动（TDD）

**Files:**
- Modify: `packages/core/src/run-agent.ts`
- Modify: `packages/core/src/run-agent.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 在 `run-agent.test.ts` 顶部 import 区加入，并在 describe 末尾加用例**

import 区加（z、tool 已有，复用）：

```ts
import type { SkillPack } from './skills/skill-pack'
```

用例（加在最后一个 `})` 前）：

```ts
  it('可注入 skillPacks：用包贡献的工具替代默认网络包', async () => {
    const executed: string[] = []
    const customPack: SkillPack = {
      name: 'demo',
      createTools: () => ({
        demo_tool: tool({
          description: 'demo',
          inputSchema: z.object({}),
          execute: async () => {
            executed.push('x')
            return 'done'
          }
        })
      })
    }
    const model = scripted([{ tool: { name: 'demo_tool', input: {} } }, { text: '完成' }])
    const result = await runAgent('做点什么', { model, skillPacks: [customPack] })
    expect(executed).toEqual(['x'])
    expect(result.toolCalls.map((c) => c.toolName)).toContain('demo_tool')
  })
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: FAIL —— `skillPacks` 未被使用，`demo_tool` 不在工具集，模型调用它无法执行（`executed` 为空）。

- [ ] **Step 3: 改 `packages/core/src/run-agent.ts`**

把顶部三行工具 import 删除并改为技能包 import：删除

```ts
import { createNetworkTools } from './tools/network.js'
import { createNetworkFixTools } from './tools/network-fix.js'
import { createNetworkVerifyTools } from './tools/network-verify.js'
```

新增

```ts
import {
  composeTools,
  composeSystemPrompts,
  type SkillPack,
  type SkillContext
} from './skills/skill-pack.js'
import { networkSkillPack } from './skills/network-pack.js'
```

`RunAgentDeps` 加一项：

```ts
  /** 注入技能包（每包贡献工具+系统提示）；不传则用默认 [networkSkillPack]。 */
  skillPacks?: SkillPack[]
```

把 `SYSTEM_PROMPT` 常量替换为域无关的 `BASE_SYSTEM`（网络域复测要求已移到 networkSkillPack）：

```ts
const BASE_SYSTEM = `你是 OpenFix，帮普通人排查并修复电脑问题的助手。
先用只读工具查清情况；确有必要时可调用"可逆"修复工具——会自动记录、可一键还原。
不要执行没把握的或不可逆的破坏性操作。最后用简短的大白话告诉用户你查到/改了什么。`
```

把函数体里"构造 tools"与 `generateText` 调用替换为：

```ts
  const model = deps.model ?? getModel()
  const shell = deps.shell ?? runReadOnly
  const changeLog = deps.changeLog ?? new ChangeLog()
  const verification = new Verification()
  const skillContext: SkillContext = { shell, changeLog, verification }
  const packs = deps.skillPacks ?? [networkSkillPack]
  const tools = deps.tools ?? composeTools(packs, skillContext)
  const system = deps.tools
    ? BASE_SYSTEM
    : [BASE_SYSTEM, composeSystemPrompts(packs)].filter(Boolean).join('\n\n')

  const result = await generateText({
    model,
    tools,
    system,
    ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
    stopWhen: stepCountIs(8)
  })
```

> 其余（`allToolCalls`、回滚策略、return）保持不变。

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: PASS（原 7 + 新 1 = 8 用例）。

- [ ] **Step 5: 导出技能包 API —— 在 `packages/core/src/index.ts` 末尾追加**

```ts
export { composeTools, composeSystemPrompts } from './skills/skill-pack.js'
export type { SkillPack, SkillContext } from './skills/skill-pack.js'
export { networkSkillPack } from './skills/network-pack.js'
```

- [ ] **Step 6: 全量测试 + typecheck + build**

Run: `pnpm --filter @openfix/core test && pnpm --filter @openfix/core typecheck && pnpm --filter @openfix/core build`
Expected: 全 PASS / 无错。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/run-agent.ts packages/core/src/run-agent.test.ts packages/core/src/index.ts
git commit -m "feat(core): runAgent 改为组合技能包驱动（默认 networkSkillPack）"
```

---

## Self-Review（对照 spec）

**1. Spec 覆盖（内核 + 可插拔技能包）：**
- "技能包 = plugin 式：每个包向 core 注册 {症状·诊断知识·工具·复测}" → `SkillPack{name,createTools,systemPrompt}`（Task 1）✅
- "内核只写一次，每个包只管自己的诊断知识和工具" → runAgent 组合 packs，网络工具收进 networkSkillPack（Task 2/3）✅
- "以后加包都是同一机制" → `deps.skillPacks` 注入 + 默认列表（Task 3，3b 将据此加包 B）✅
- **不覆盖（YAGNI/后续）**：拆成独立 `packages/skill-network`；软件/系统包 B（Plan 3b）。

**2. 占位符扫描：** 无 TBD/TODO；代码与命令完整。✅

**3. 类型一致性：** `SkillContext{shell,changeLog,verification}` 在 skill-pack 定义、network-pack 使用（ctx.*）、run-agent 构造三处一致；`SkillPack` 在 skill-pack 定义、network-pack 实现、run-agent deps、index 导出一致；`composeTools/composeSystemPrompts` 签名在定义与 run-agent 调用一致；删除的 `createNetworkTools/FixTools/VerifyTools` 在 run-agent 中已无引用（仅 network-pack 引用）。✅
