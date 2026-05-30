# OpenFix Plan 7a：core streamAgent（真·流式）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** core 新增 `streamAgent()`——用 `streamText` + `fullStream`，把工具步骤、文字结论通过 `onEvent` 回调实时推出；与 `runAgent` 共享装配/收尾逻辑，最终返回与 `runAgent` 等价的 `AgentResult`。`runAgent` 行为不变（既有测试零回归）。

**Architecture:** 抽出 `run-shared.ts`（`assembleRun(deps)` 装配 model/shell/tools/system/changeLog/verification；`finalizeRun(changeLog,verification,baseText)` 收尾安全策略；`BASE_SYSTEM`；`AgentEvent` 类型）。`runAgent` 改用这两个 helper（保持等价）。`stream-agent.ts` 用 `assembleRun` + `streamText`，遍历 `fullStream` 映射成 `AgentEvent` 回调，结束后 `finalizeRun` 并 `onEvent({type:'done',result})`。

**Tech Stack:** TypeScript · Vercel AI SDK（`streamText`/`fullStream`/`simulateReadableStream`/`MockLanguageModelV2.doStream`）· Vitest。

> **范围（No silent caps）：** 仅 core 流式引擎。不含 IPC（7b）、渲染层（7c）。`AgentEvent` 取设计稿的实用子集：`phase/step/text/change/verify/done/error`；`step` 只带 `tool` 名，风险/图标由渲染层 toolLabels 映射（7c）。
> **执行注：** `fullStream` 的 part 形状随 AI SDK 版本略有差异（text-delta 的 `.text`/`.delta`、part 类型名）。实现里对 text 增量做 `part.text ?? part.delta` 兼容；若测试报形状不符，按实际 part 调整映射（TDD 驱动）。

---

## File Structure

```
packages/core/src/
├── run-shared.ts          # assembleRun / finalizeRun / BASE_SYSTEM / AgentEvent（新建）
├── run-shared.test.ts     # assembleRun/finalizeRun 单测（新建）
├── run-agent.ts           # 改用 run-shared 的 helper（重构，行为不变）
├── stream-agent.ts        # streamAgent（新建）
├── stream-agent.test.ts   # doStream mock 流式测试（新建）
└── index.ts               # 导出 streamAgent / AgentEvent（修改）
```

---

## Task 1: 抽出 run-shared（assembleRun / finalizeRun / AgentEvent）（TDD）

**Files:**
- Create: `packages/core/src/run-shared.ts`
- Test: `packages/core/src/run-shared.test.ts`

- [ ] **Step 1: 写失败测试 `packages/core/src/run-shared.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { assembleRun, finalizeRun } from './run-shared'
import { ChangeLog } from './safety/change-log'
import { Verification } from './safety/verification'

describe('assembleRun', () => {
  it('默认装配出网络+系统工具与系统提示', () => {
    const a = assembleRun({ model: {} as never, shell: async () => ({ code: 0, stdout: '', stderr: '' }) })
    expect(Object.keys(a.tools)).toContain('set_dns_servers')
    expect(Object.keys(a.tools)).toContain('empty_trash')
    expect(a.system).toMatch(/OpenFix/)
  })

  it('注入 tools 时直接用注入的工具', () => {
    const a = assembleRun({ model: {} as never, tools: { foo: {} as never } })
    expect(Object.keys(a.tools)).toEqual(['foo'])
  })
})

describe('finalizeRun', () => {
  it('有可逆改动但复测未过 → 回滚 + rolledBack + 文案', async () => {
    const changeLog = new ChangeLog()
    let rolled = false
    changeLog.record({ description: '改了X', riskLevel: 'reversible', rollback: async () => void (rolled = true) })
    const verification = new Verification()
    const r = await finalizeRun(changeLog, verification, '试着修了')
    expect(rolled).toBe(true)
    expect(r.rolledBack).toBe(true)
    expect(r.text).toMatch(/还原/)
  })

  it('不可逆改动不参与回滚', async () => {
    const changeLog = new ChangeLog()
    changeLog.record({ description: '清空废纸篓', riskLevel: 'irreversible', rollback: async () => {} })
    const verification = new Verification()
    const r = await finalizeRun(changeLog, verification, '清了')
    expect(r.rolledBack).toBe(false)
    expect(r.changes).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/run-shared.test.ts`
Expected: FAIL —— 找不到 `./run-shared`。

- [ ] **Step 3: 实现 `packages/core/src/run-shared.ts`**

```ts
import { type LanguageModel, type ToolSet } from 'ai'
import { getModel } from './llm.js'
import { runReadOnly, type ShellRunner } from './shell.js'
import { ChangeLog, type ChangeSummary } from './safety/change-log.js'
import { Verification } from './safety/verification.js'
import {
  composeTools,
  composeSystemPrompts,
  type SkillPack,
  type SkillContext
} from './skills/skill-pack.js'
import { networkSkillPack } from './skills/network-pack.js'
import { systemSkillPack } from './skills/system-pack.js'

export const BASE_SYSTEM = `你是 OpenFix，帮普通人排查并修复电脑问题的助手。
先用只读工具查清情况；确有必要时可调用"可逆"修复工具——会自动记录、可一键还原。
不要执行没把握的或不可逆的破坏性操作。最后用简短的大白话告诉用户你查到/改了什么。`

export interface AgentResult {
  text: string
  toolCalls: Array<{ toolName: string; input: unknown }>
  changes: ChangeSummary[]
  rolledBack: boolean
}

export type AgentEvent =
  | { type: 'phase'; phase: 'investigating' | 'fixing' | 'verifying' }
  | { type: 'step'; tool: string }
  | { type: 'text'; delta: string }
  | { type: 'change'; change: ChangeSummary }
  | { type: 'verify'; passed: boolean }
  | { type: 'done'; result: AgentResult }
  | { type: 'error'; message: string }

export interface RunDeps {
  model?: LanguageModel
  tools?: ToolSet
  shell?: ShellRunner
  changeLog?: ChangeLog
  skillPacks?: SkillPack[]
  confirm?: (description: string) => Promise<boolean>
}

export interface Assembled {
  model: LanguageModel
  tools: ToolSet
  system: string
  changeLog: ChangeLog
  verification: Verification
}

/** 装配一次运行所需的 model/tools/system/账本/复测（runAgent 与 streamAgent 共用）。 */
export function assembleRun(deps: RunDeps): Assembled {
  const model = deps.model ?? getModel()
  const shell = deps.shell ?? runReadOnly
  const changeLog = deps.changeLog ?? new ChangeLog()
  const verification = new Verification()
  const skillContext: SkillContext = { shell, changeLog, verification, confirm: deps.confirm }
  const packs = deps.skillPacks ?? [networkSkillPack, systemSkillPack]
  const tools = deps.tools ?? composeTools(packs, skillContext)
  const system = deps.tools
    ? BASE_SYSTEM
    : [BASE_SYSTEM, composeSystemPrompts(packs)].filter(Boolean).join('\n\n')
  return { model, tools, system, changeLog, verification }
}

/** 收尾安全策略：有可逆改动但复测未过 → 回滚可逆项 + 追加还原文案。 */
export async function finalizeRun(
  changeLog: ChangeLog,
  verification: Verification,
  baseText: string
): Promise<{ text: string; changes: ChangeSummary[]; rolledBack: boolean }> {
  const applied = changeLog.list()
  const reversibleApplied = applied.filter((c) => c.riskLevel === 'reversible')
  let rolledBack = false
  if (reversibleApplied.length > 0 && verification.passed !== true) {
    await changeLog.rollbackReversible()
    rolledBack = true
  }
  let text = baseText
  if (rolledBack) {
    text = `${text}\n\n（修复没有通过复测，我已把改动全部还原，系统恢复原样。）`.trim()
  }
  return { text, changes: applied, rolledBack }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/run-shared.test.ts`
Expected: PASS（4 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/run-shared.ts packages/core/src/run-shared.test.ts
git commit -m "feat(core): 抽出 run-shared（assembleRun/finalizeRun/AgentEvent）"
```

---

## Task 2: runAgent 改用 run-shared（重构，行为不变）

**Files:**
- Modify: `packages/core/src/run-agent.ts`

- [ ] **Step 1: 重写 `run-agent.ts` 为基于 run-shared 的薄封装**

```ts
import { generateText, stepCountIs } from 'ai'
import { assembleRun, finalizeRun, type RunDeps, type AgentResult } from './run-shared.js'

export type { AgentResult, RunDeps as RunAgentDeps } from './run-shared.js'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function runAgent(input: string | ChatMessage[], deps: RunDeps = {}): Promise<AgentResult> {
  const { model, tools, system, changeLog, verification } = assembleRun(deps)

  const result = await generateText({
    model,
    tools,
    system,
    ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
    stopWhen: stepCountIs(8)
  })

  const toolCalls = result.steps
    .flatMap((s) => s.toolCalls)
    .map((c) => ({ toolName: c.toolName, input: c.input }))
  const fin = await finalizeRun(changeLog, verification, result.text)
  return { text: fin.text, toolCalls, changes: fin.changes, rolledBack: fin.rolledBack }
}
```

> 注：`RunAgentDeps` 现等价于 `RunDeps`（含 model/tools/shell/changeLog/skillPacks/confirm），既有测试注入的字段不变。`ChatMessage`、`AgentResult` 对外导出保持。

- [ ] **Step 2: 全量测试（既有 run-agent 测试零回归）**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: PASS（既有 11 用例全过）。

- [ ] **Step 3: 修 `index.ts`（若 `AgentResult`/`RunAgentDeps` 来源变化，确保仍导出）**

确认 `index.ts` 里：

```ts
export { runAgent } from './run-agent.js'
export type { AgentResult, RunAgentDeps, ChatMessage } from './run-agent.js'
```

仍成立（run-agent 重新导出了这些）。无需改动则跳过。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/run-agent.ts
git commit -m "refactor(core): runAgent 改用 run-shared（行为不变）"
```

---

## Task 3: streamAgent（TDD，doStream mock）

**Files:**
- Create: `packages/core/src/stream-agent.ts`
- Test: `packages/core/src/stream-agent.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 写失败测试 `packages/core/src/stream-agent.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { MockLanguageModelV2 } from 'ai/test'
import { simulateReadableStream, tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { streamAgent } from './stream-agent'
import type { AgentEvent } from './run-shared'

describe('streamAgent', () => {
  it('流式发出 step 与 text 事件，最终 done 带等价 AgentResult', async () => {
    let call = 0
    const model = new MockLanguageModelV2({
      doStream: async () => {
        call += 1
        if (call === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'tool-call', toolCallId: 'c1', toolName: 'check_connectivity', input: JSON.stringify({ host: '8.8.8.8' }) },
                { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
              ]
            })
          }
        }
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: '是通的' },
              { type: 'text-end', id: 't1' },
              { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
            ]
          })
        }
      }
    })
    const tools: ToolSet = {
      check_connectivity: tool({
        description: '测连通',
        inputSchema: z.object({ host: z.string() }),
        execute: async () => ({ reachable: true })
      })
    }

    const events: AgentEvent[] = []
    const result = await streamAgent('我连不上网', { model, tools, onEvent: (e) => events.push(e) })

    expect(events.some((e) => e.type === 'step' && e.tool === 'check_connectivity')).toBe(true)
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toContain('是通的')
    expect(events.at(-1)?.type).toBe('done')
    expect(result.text).toContain('是通的')
    expect(result.toolCalls.map((c) => c.toolName)).toContain('check_connectivity')
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/stream-agent.test.ts`
Expected: FAIL —— 找不到 `./stream-agent`。

- [ ] **Step 3: 实现 `packages/core/src/stream-agent.ts`**

```ts
import { streamText, stepCountIs } from 'ai'
import { assembleRun, finalizeRun, type RunDeps, type AgentResult, type AgentEvent } from './run-shared.js'
import type { ChatMessage } from './run-agent.js'

export interface StreamDeps extends RunDeps {
  onEvent: (event: AgentEvent) => void
}

/** 流式版 agent：边跑边通过 onEvent 推 step/text/change/verify 事件，结束 done。 */
export async function streamAgent(
  input: string | ChatMessage[],
  deps: StreamDeps
): Promise<AgentResult> {
  const { model, tools, system, changeLog, verification } = assembleRun(deps)
  const { onEvent } = deps

  onEvent({ type: 'phase', phase: 'investigating' })

  const result = streamText({
    model,
    tools,
    system,
    ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
    stopWhen: stepCountIs(8)
  })

  let emittedChanges = 0
  try {
    for await (const part of result.fullStream) {
      const p = part as { type: string; toolName?: string; text?: string; delta?: string; error?: unknown }
      if (p.type === 'tool-call' && p.toolName) {
        if (p.toolName.startsWith('verify')) onEvent({ type: 'phase', phase: 'verifying' })
        onEvent({ type: 'step', tool: p.toolName })
      } else if (p.type === 'text-delta') {
        const delta = p.text ?? p.delta ?? ''
        if (delta) onEvent({ type: 'text', delta })
      } else if (p.type === 'error') {
        onEvent({ type: 'error', message: String(p.error) })
      }
      // 账本增长 → 发 change 事件（写操作发生）
      const list = changeLog.list()
      if (list.length > emittedChanges) {
        onEvent({ type: 'phase', phase: 'fixing' })
        for (let i = emittedChanges; i < list.length; i++) onEvent({ type: 'change', change: list[i] })
        emittedChanges = list.length
      }
    }
  } catch (e) {
    onEvent({ type: 'error', message: (e as Error).message })
  }

  if (verification.attempted) onEvent({ type: 'verify', passed: verification.passed === true })

  const steps = await result.steps
  const toolCalls = steps
    .flatMap((s) => s.toolCalls)
    .map((c) => ({ toolName: c.toolName, input: c.input }))
  const finalText = await result.text
  const fin = await finalizeRun(changeLog, verification, finalText)
  const agentResult: AgentResult = {
    text: fin.text,
    toolCalls,
    changes: fin.changes,
    rolledBack: fin.rolledBack
  }
  onEvent({ type: 'done', result: agentResult })
  return agentResult
}
```

- [ ] **Step 4: 运行，确认通过（按需调整 part 形状）**

Run: `pnpm --filter @openfix/core test src/stream-agent.test.ts`
Expected: PASS。若失败信息提示 part 类型/字段不符（如 text 增量在 `part.text` 还是 `part.delta`、tool-call 部件名），按实际报错调整映射后再跑。

- [ ] **Step 5: 导出 —— `index.ts` 末尾追加**

```ts
export { streamAgent } from './stream-agent.js'
export type { StreamDeps } from './stream-agent.js'
export type { AgentEvent } from './run-shared.js'
```

- [ ] **Step 6: 全量测试 + typecheck + build**

Run: `pnpm --filter @openfix/core test && pnpm --filter @openfix/core typecheck && pnpm --filter @openfix/core build`
Expected: 全 PASS / 无错。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/stream-agent.ts packages/core/src/stream-agent.test.ts packages/core/src/index.ts
git commit -m "feat(core): streamAgent 真·流式（fullStream → AgentEvent）"
```

---

## Self-Review

**1. 设计稿覆盖（§4.1/§4.2）：** streamAgent + AgentEvent ✅；与 runAgent 共享装配/收尾（run-shared）✅；runAgent 行为不变 ✅。事件协议取实用子集（step 不带 risk，留渲染层 toolLabels）——记为对设计稿的有意简化。
**2. 占位符：** 无 TBD/TODO；代码完整；流式 part 形状的不确定性已显式标注由 TDD 调整。
**3. 类型一致性：** `RunDeps`/`AgentResult`/`AgentEvent` 在 run-shared 定义，被 run-agent、stream-agent、index 一致引用；`assembleRun`/`finalizeRun` 签名在定义与两个调用方一致。✅
**协调：** 另一会话未产出任何实现，本期独占 core 流式；不碰 GUI（7b/7c 再做）。
