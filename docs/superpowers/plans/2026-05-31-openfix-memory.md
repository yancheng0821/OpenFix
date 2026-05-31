# OpenFix 轻量记忆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 OpenFix 一个本地、全自动、可手动编辑的轻量记忆（机器事实/偏好/过往修复），每次运行注入 system prompt，agent 用 `remember` 工具静默写。

**Architecture:** 记忆"文档逻辑"（格式/脚手架/去重/敏感守卫/注入拼装）全部放 `@openfix/core`（平台无关、可单测）；desktop 主进程只做薄薄的 fs/electron 胶水（路径、读写文件、用默认编辑器打开）。读=整个文件注入 system；写=core 的 `remember` 工具 → 主进程 `appendMemory` 落盘。

**Tech Stack:** TypeScript（pnpm monorepo），Vercel AI SDK v5（`tool`/`ToolSet`），vitest，Electron（main/preload/renderer），React。

参考 spec：`docs/superpowers/specs/2026-05-31-openfix-memory-design.md`

---

## 文件结构

**core（`packages/core`）**
- 新增 `src/memory/memory.ts` — 记忆文档逻辑：类型、`looksSensitive`、`composeMemoryInjection`（读）、`SCAFFOLD`+`applyMemory`（写合并）。
- 新增 `src/tools/memory-tool.ts` — `createMemoryTool(remember)` → `{ remember }` 工具。
- 改 `src/run-shared.ts` — `RunDeps.memory`，assembleRun 注入 + 加工具。
- 改 `src/stream-agent.ts` — `phaseForTool` 把 `remember` 归到 `thinking`。
- 改 `src/index.ts` — 导出新公共符号。

**desktop（`apps/desktop`）**
- 新增 `src/main/memory.ts` — `memoryPath`/`readMemory`/`appendMemory`/`openMemory`（fs+electron 胶水）。
- 改 `src/main/index.ts` — `agent:run` 传 `memory`；加 `memory:open` IPC。
- 改 `src/preload/index.ts` + `src/preload/index.d.ts` — 暴露 `openMemoryFile()`。
- 改 `src/renderer/src/App.tsx` — 设置里"打开记忆文件"按钮。
- 改 `src/renderer/src/lib/toolLabels.ts` — `remember` → "记住"。

---

## Task 1: core 记忆文档模块

**Files:**
- Create: `packages/core/src/memory/memory.ts`
- Test: `packages/core/src/memory/memory.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 写失败测试**

Create `packages/core/src/memory/memory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { looksSensitive, composeMemoryInjection, applyMemory, SCAFFOLD } from './memory'

describe('looksSensitive', () => {
  it('密钥/密码/隐私路径判为敏感', () => {
    expect(looksSensitive('我的密码是 abc123')).toBe(true)
    expect(looksSensitive('api_key=sk-xxx')).toBe(true)
    expect(looksSensitive('看 ~/.ssh/id_rsa')).toBe(true)
  })
  it('普通机器事实不敏感', () => {
    expect(looksSensitive('活动网卡 en7=AX88179B')).toBe(false)
    expect(looksSensitive('装了 Homebrew')).toBe(false)
  })
})

describe('composeMemoryInjection', () => {
  it('空内容→空串（不注入）', () => {
    expect(composeMemoryInjection('')).toBe('')
    expect(composeMemoryInjection('   \n  ')).toBe('')
  })
  it('非空→带标头包裹', () => {
    const out = composeMemoryInjection('## 机器事实\n- en7=AX88179B')
    expect(out).toMatch(/关于这台机器/)
    expect(out).toMatch(/en7=AX88179B/)
    expect(out).toMatch(/remember/)
  })
})

describe('applyMemory', () => {
  it('空内容→用脚手架并写到对应分节', () => {
    const out = applyMemory('', { category: 'machine', note: '装了 Homebrew' })
    expect(out).not.toBeNull()
    const lines = (out as string).split('\n')
    const hi = lines.findIndex((l) => l.trim() === '## 机器事实')
    expect(lines[hi + 1].trim()).toBe('- 装了 Homebrew')
  })
  it('不同 category 落到不同分节', () => {
    let doc = applyMemory('', { category: 'preference', note: '偏好 DNS 8.8.8.8' }) as string
    doc = applyMemory(doc, { category: 'fix', note: '关过 AX88179B 代理' }) as string
    const idxPref = doc.indexOf('偏好 DNS 8.8.8.8')
    const idxFix = doc.indexOf('关过 AX88179B 代理')
    expect(doc.slice(0, idxPref)).toMatch(/## 偏好/)
    expect(doc.slice(0, idxFix)).toMatch(/## 过往修复/)
  })
  it('完全相同的条目→去重返回 null', () => {
    const doc = applyMemory('', { category: 'machine', note: '装了 Homebrew' }) as string
    expect(applyMemory(doc, { category: 'machine', note: '装了 Homebrew' })).toBeNull()
  })
  it('敏感内容→不写返回 null', () => {
    expect(applyMemory(SCAFFOLD, { category: 'machine', note: '密码 abc123' })).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @openfix/core test memory`
Expected: FAIL（`Cannot find module './memory'`）

- [ ] **Step 3: 实现 `memory.ts`**

Create `packages/core/src/memory/memory.ts`:

```typescript
/** 记忆分类：machine=机器事实，preference=用户偏好，fix=过往修复。 */
export type MemoryCategory = 'machine' | 'preference' | 'fix'

export interface MemoryEntry {
  category: MemoryCategory
  note: string
}

const SECTION: Record<MemoryCategory, string> = {
  machine: '## 机器事实',
  preference: '## 偏好',
  fix: '## 过往修复'
}

/** 空记忆文件的脚手架。 */
export const SCAFFOLD = `# OpenFix 记忆（自动维护，可手动编辑/删除）

## 机器事实

## 偏好

## 过往修复
`

/** 敏感内容守卫：命中即不入记忆（避免密钥/账号/隐私路径上云）。 */
const SENSITIVE =
  /password|passwd|密码|secret|token|api[_-]?key|apikey|private key|私钥|助记词|seed phrase|\.ssh|\.aws|\.gnupg|id_rsa|id_ed25519|\.pem|\.p12|\.key\b|credentials|keychain/i

export function looksSensitive(note: string): boolean {
  return SENSITIVE.test(note)
}

/** 把记忆内容包成注入 system 的片段；空内容返回空串（不注入）。 */
export function composeMemoryInjection(content: string): string {
  const c = content.trim()
  if (!c) return ''
  return `【关于这台机器和用户（你之前记下的）】\n${c}\n（若其中某条已过时/与实际不符，以实际为准，并用 remember 更新。）`
}

/** 在指定分节标题下插入一行。找不到分节则追加到文末新建该分节。 */
function insertUnderSection(content: string, header: string, line: string): string {
  const lines = content.split('\n')
  const idx = lines.findIndex((l) => l.trim() === header)
  if (idx === -1) return `${content.replace(/\s*$/, '')}\n\n${header}\n${line}\n`
  lines.splice(idx + 1, 0, line)
  return lines.join('\n')
}

/**
 * 纯函数：把一条记忆并入现有内容。
 * 敏感或与现有条目完全重复 → 返回 null（不写）。空内容用脚手架。
 */
export function applyMemory(current: string, entry: MemoryEntry): string | null {
  if (looksSensitive(entry.note)) return null
  const header = SECTION[entry.category] ?? SECTION.machine
  const base = current.trim() ? current : SCAFFOLD
  const line = `- ${entry.note.trim()}`
  if (base.split('\n').some((l) => l.trim() === line)) return null
  return insertUnderSection(base, header, line)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @openfix/core test memory`
Expected: PASS（4 个 describe 全绿）

- [ ] **Step 5: 导出公共符号**

In `packages/core/src/index.ts`, append after line 14（`export type { AgentEvent } ...`）:

```typescript
export {
  looksSensitive,
  composeMemoryInjection,
  applyMemory,
  SCAFFOLD
} from './memory/memory.js'
export type { MemoryCategory, MemoryEntry } from './memory/memory.js'
```

- [ ] **Step 6: typecheck + commit**

```bash
pnpm --filter @openfix/core typecheck
git add packages/core/src/memory/memory.ts packages/core/src/memory/memory.test.ts packages/core/src/index.ts
git commit -m "feat(core): 记忆文档模块（注入拼装/写合并/敏感守卫）"
```

---

## Task 2: core `remember` 工具

**Files:**
- Create: `packages/core/src/tools/memory-tool.ts`
- Test: `packages/core/src/tools/memory-tool.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 写失败测试**

Create `packages/core/src/tools/memory-tool.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { MemoryEntry } from '../memory/memory'
import { createMemoryTool } from './memory-tool'

const okOptions = { toolCallId: 't1', messages: [] } as never

describe('remember 工具', () => {
  it('普通条目：调一次写回调并返回"已记住"', async () => {
    const saved: MemoryEntry[] = []
    const tools = createMemoryTool(async (e) => {
      saved.push(e)
    })
    const out = (await tools.remember.execute!(
      { category: 'machine', note: '活动网卡 en7=AX88179B' },
      okOptions
    )) as string
    expect(out).toMatch(/已记住/)
    expect(saved).toEqual([{ category: 'machine', note: '活动网卡 en7=AX88179B' }])
  })

  it('敏感条目：不写、返回隐私提示', async () => {
    const saved: MemoryEntry[] = []
    const tools = createMemoryTool(async (e) => {
      saved.push(e)
    })
    const out = (await tools.remember.execute!(
      { category: 'preference', note: '我的密码是 abc123' },
      okOptions
    )) as string
    expect(out).toMatch(/隐私/)
    expect(saved).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @openfix/core test memory-tool`
Expected: FAIL（`Cannot find module './memory-tool'`）

- [ ] **Step 3: 实现 `memory-tool.ts`**

Create `packages/core/src/tools/memory-tool.ts`:

```typescript
import { z } from 'zod'
import { tool, type ToolSet } from 'ai'
import { looksSensitive, type MemoryEntry } from '../memory/memory.js'

/** 让 agent 静默记住关于这台机器/用户的耐久、非敏感信息。 */
export function createMemoryTool(remember: (entry: MemoryEntry) => Promise<void>): ToolSet {
  return {
    remember: tool({
      description:
        '记住关于这台机器或用户的耐久事实/偏好/过往修复，方便以后更快帮上忙。只记非敏感、长期有用的信息；别记一次性的，更别记密钥/账号密码/隐私路径。',
      inputSchema: z.object({
        category: z
          .enum(['machine', 'preference', 'fix'])
          .describe('machine=机器事实，preference=用户偏好，fix=过往修复'),
        note: z.string().describe('一句话、具体、耐久。例：活动网卡 en7=AX88179B')
      }),
      execute: async ({ category, note }) => {
        if (looksSensitive(note)) return '出于隐私，这条没记。'
        await remember({ category, note })
        return `已记住：${note}`
      }
    })
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @openfix/core test memory-tool`
Expected: PASS（2 个）

- [ ] **Step 5: 导出**

In `packages/core/src/index.ts`, append:

```typescript
export { createMemoryTool } from './tools/memory-tool.js'
```

- [ ] **Step 6: typecheck + commit**

```bash
pnpm --filter @openfix/core typecheck
git add packages/core/src/tools/memory-tool.ts packages/core/src/tools/memory-tool.test.ts packages/core/src/index.ts
git commit -m "feat(core): remember 工具（敏感守卫+静默写）"
```

---

## Task 3: assembleRun 接入记忆（注入 + 工具）

**Files:**
- Modify: `packages/core/src/run-shared.ts`
- Test: `packages/core/src/run-shared.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/core/src/run-shared.test.ts` 顶部已有 `import { assembleRun, finalizeRun, concludeIfNeeded } from './run-shared'`，无需改 import。在文件末尾追加：

```typescript
describe('assembleRun 记忆接入', () => {
  it('传 memory：system 含注入文案、工具集含 remember', () => {
    const a = assembleRun({
      model: {} as never,
      memory: { content: '## 机器事实\n- en7=AX88179B', remember: async () => {} }
    })
    expect(a.system).toMatch(/关于这台机器/)
    expect(a.system).toMatch(/en7=AX88179B/)
    expect('remember' in a.tools).toBe(true)
  })

  it('不传 memory：system 无注入、工具集无 remember', () => {
    const a = assembleRun({ model: {} as never })
    expect(a.system).not.toMatch(/关于这台机器/)
    expect('remember' in a.tools).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @openfix/core test run-shared`
Expected: FAIL（remember 不在工具集 / system 不含注入）

- [ ] **Step 3: 实现接入**

In `packages/core/src/run-shared.ts`:

(a) 顶部 import 区追加：

```typescript
import { createMemoryTool } from './tools/memory-tool.js'
import { composeMemoryInjection, type MemoryEntry } from './memory/memory.js'
```

(b) `RunDeps` 接口里加一行（在 `confirm?` 之后）：

```typescript
  /** 本地记忆：注入内容 + 写回调（由宿主进程提供文件 I/O）。 */
  memory?: { content: string; remember: (entry: MemoryEntry) => Promise<void> }
```

(c) 把 `assembleRun` 里 `tools` 和 `system` 两段替换为：

```typescript
  const tools =
    deps.tools ?? {
      ...createDiagnosticTools(shell),
      ...createProposeFixTool({ shell, changeLog, confirm: deps.confirm }),
      ...composeTools(packs, skillContext),
      ...(deps.memory ? createMemoryTool(deps.memory.remember) : {})
    }
  const system = deps.tools
    ? BASE_SYSTEM
    : [BASE_SYSTEM, composeSystemPrompts(packs), composeMemoryInjection(deps.memory?.content ?? '')]
        .filter(Boolean)
        .join('\n\n')
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @openfix/core test run-shared`
Expected: PASS（含新增 2 个）

- [ ] **Step 5: typecheck + commit**

```bash
pnpm --filter @openfix/core typecheck
git add packages/core/src/run-shared.ts packages/core/src/run-shared.test.ts
git commit -m "feat(core): assembleRun 注入记忆并挂载 remember 工具"
```

---

## Task 4: 运行状态——remember 归到"思考"

**Files:**
- Modify: `packages/core/src/stream-agent.ts`
- Test: `packages/core/src/stream-agent.test.ts`

- [ ] **Step 1: 写失败测试**

In `packages/core/src/stream-agent.test.ts`, 顶部 import 改为含 `phaseForTool`（例：`import { streamAgent, phaseForTool } from './stream-agent'`），并追加：

```typescript
describe('phaseForTool', () => {
  it('remember 归到 thinking（记笔记不显示"修复"）', () => {
    expect(phaseForTool('remember')).toBe('thinking')
  })
  it('诊断/打开/复测/写各归其位', () => {
    expect(phaseForTool('run_diagnostic')).toBe('investigating')
    expect(phaseForTool('open_app')).toBe('working')
    expect(phaseForTool('verify_connectivity')).toBe('verifying')
    expect(phaseForTool('set_dns_servers')).toBe('fixing')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @openfix/core test stream-agent`
Expected: FAIL（`phaseForTool` 未导出）

- [ ] **Step 3: 实现**

In `packages/core/src/stream-agent.ts`, 把 `phaseForTool` 改为导出，并在 verify 之后加 remember 分支：

```typescript
/** 把工具映射到"它当下在做什么"，让界面状态贴合实际（不是一律"排查"）。 */
export function phaseForTool(tool: string): AgentPhase {
  if (tool.startsWith('verify')) return 'verifying'
  if (tool === 'remember') return 'thinking'
  if (tool === 'open_app' || tool === 'open_url') return 'working'
  if (
    tool === 'run_diagnostic' ||
    tool.startsWith('check_') ||
    tool.startsWith('get_') ||
    tool.startsWith('resolve_')
  )
    return 'investigating'
  return 'fixing'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @openfix/core test stream-agent`
Expected: PASS

- [ ] **Step 5: typecheck + build + commit**

```bash
pnpm --filter @openfix/core typecheck && pnpm --filter @openfix/core build
git add packages/core/src/stream-agent.ts packages/core/src/stream-agent.test.ts
git commit -m "feat(core): remember 工具运行状态归为思考"
```

---

## Task 5: desktop 记忆文件 I/O（薄胶水）

**Files:**
- Create: `apps/desktop/src/main/memory.ts`

> 说明：纯逻辑（格式/去重/敏感）已在 core 单测覆盖；本文件只是 fs+electron 胶水，与 `config.ts` 一样不单测，靠 typecheck + 冒烟验证。

- [ ] **Step 1: 实现 `memory.ts`**

Create `apps/desktop/src/main/memory.ts`:

```typescript
import { app, shell } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { applyMemory, SCAFFOLD, type MemoryEntry } from '@openfix/core'

export function memoryPath(): string {
  return join(app.getPath('userData'), 'openfix-memory.md')
}

/** 读记忆内容；缺失/损坏 → 空串（不阻断运行）。 */
export function readMemory(): string {
  try {
    if (existsSync(memoryPath())) return readFileSync(memoryPath(), 'utf-8')
  } catch {
    // 损坏当作空
  }
  return ''
}

/** 追加一条记忆（敏感/重复由 core 的 applyMemory 决定跳过）；写失败吞掉。 */
export function appendMemory(entry: MemoryEntry): void {
  try {
    const next = applyMemory(readMemory(), entry)
    if (next !== null) writeFileSync(memoryPath(), next, 'utf-8')
  } catch {
    // 记忆是增强项，写失败不影响主流程
  }
}

/** 用默认编辑器打开记忆文件（不存在则先建脚手架）。 */
export function openMemory(): void {
  try {
    if (!existsSync(memoryPath())) writeFileSync(memoryPath(), SCAFFOLD, 'utf-8')
    void shell.openPath(memoryPath())
  } catch {
    // 打开失败忽略
  }
}
```

- [ ] **Step 2: typecheck + commit**

```bash
pnpm --filter @openfix/desktop typecheck
git add apps/desktop/src/main/memory.ts
git commit -m "feat(desktop): 记忆文件 I/O（path/read/append/open）"
```

---

## Task 6: desktop 主进程接线（agent:run 传记忆 + memory:open IPC）

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: import 记忆模块**

In `apps/desktop/src/main/index.ts`, 把 `import { loadConfig, saveConfig, type AppConfig } from './config'`（第 13 行）下面加一行：

```typescript
import { readMemory, appendMemory, openMemory } from './memory'
```

并在顶部 `@openfix/core` 的 import 里加上 `type MemoryEntry`（即 `import { streamAgent, ChangeLog, createModel, networkSkillPack, type AgentEvent, type MemoryEntry } from '@openfix/core'`）。

- [ ] **Step 2: 两个 streamAgent 调用都带上 memory**

In `agent:run` handler，构造一个 memory 对象并传入两处 `streamAgent`。把 `const cfg = loadConfig()`（约第 89 行）下面加：

```typescript
      const memory = {
        content: readMemory(),
        remember: async (e: MemoryEntry): Promise<void> => appendMemory(e)
      }
```

然后在**云端**那次 `streamAgent(messages, { ... })` 的 deps 里加 `memory,`：

```typescript
        result = await streamAgent(messages, {
          changeLog,
          onEvent: send,
          confirm,
          model: createModel(cfg.cloud),
          memory
        })
```

在**本地回退**那次 `streamAgent(messages, { ... })` 的 deps 里也加 `memory,`：

```typescript
          result = await streamAgent(messages, {
            changeLog,
            onEvent: send,
            confirm,
            model: createModel({ baseURL: cfg.local.baseURL, apiKey: 'ollama', model: cfg.local.model }),
            skillPacks: [networkSkillPack],
            memory
          })
```

- [ ] **Step 3: 加 memory:open IPC**

在 `ipcMain.handle('config:set', ...)`（约第 143-146 行）之后加：

```typescript
  ipcMain.handle('memory:open', () => {
    openMemory()
    return { ok: true }
  })
```

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @openfix/desktop typecheck
git add apps/desktop/src/main/index.ts
git commit -m "feat(desktop): 运行时注入记忆 + memory:open IPC"
```

---

## Task 7: preload 暴露 openMemoryFile

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/preload/index.d.ts`

- [ ] **Step 1: preload 加方法**

In `apps/desktop/src/preload/index.ts`，`const api = { ... }` 里 `setConfig` 那一行末尾加逗号并追加：

```typescript
  setConfig: (cfg: AppConfig): Promise<{ ok: boolean }> => ipcRenderer.invoke('config:set', cfg),
  openMemoryFile: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('memory:open')
```

- [ ] **Step 2: d.ts 加签名**

In `apps/desktop/src/preload/index.d.ts`，`setConfig: (...) => Promise<{ ok: boolean }>`（约第 24-27 行）之后加：

```typescript
      openMemoryFile: () => Promise<{ ok: boolean }>
```

- [ ] **Step 3: typecheck + commit**

```bash
pnpm --filter @openfix/desktop typecheck
git add apps/desktop/src/preload/index.ts apps/desktop/src/preload/index.d.ts
git commit -m "feat(desktop): preload 暴露 openMemoryFile"
```

---

## Task 8: renderer——设置里"打开记忆文件"按钮 + remember 标签

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/lib/toolLabels.ts`

- [ ] **Step 1: toolLabels 加 remember**

In `apps/desktop/src/renderer/src/lib/toolLabels.ts`，`LABELS` 里 `open_url` 那行之后加：

```typescript
  remember: { label: '记住', risk: 'read' },
```

- [ ] **Step 2: 设置弹窗加按钮**

In `apps/desktop/src/renderer/src/App.tsx`，设置弹窗里 `本地模型` 那个 `settings__hint` 块（"本地模型需先装 Ollama …"）之后、`</div>`(关闭 `.settings`) 之前，加：

```tsx
              <div className="settings__group">记忆</div>
              <div className="settings__hint">
                OpenFix 会自动记住这台机器的事实和你的偏好（只存非敏感信息），让以后更快帮上忙。
              </div>
              <button
                className="changes__undo"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => void window.api.openMemoryFile()}
              >
                打开记忆文件
              </button>
```

- [ ] **Step 3: 跑现有渲染测试确认没回归**

Run: `pnpm --filter @openfix/desktop test`
Expected: PASS（仍 7 个；本步无新测试，按仓库惯例 Electron/React 胶水靠类型+冒烟）

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @openfix/desktop typecheck
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/lib/toolLabels.ts
git commit -m "feat(desktop): 设置里打开记忆文件 + remember 标签"
```

---

## Task 9: 全量验证 + 冒烟 + 收尾

**Files:** 无（仅验证）

- [ ] **Step 1: 全量测试 + 类型 + 构建**

```bash
pnpm --filter @openfix/core test
pnpm --filter @openfix/core typecheck && pnpm --filter @openfix/core build
pnpm --filter @openfix/desktop typecheck && pnpm --filter @openfix/desktop test
```
Expected: core 全绿（约 +10 测试）、desktop 7 绿、typecheck/build OK。

- [ ] **Step 2: 真机冒烟（手动）**

```bash
pnpm --filter @openfix/desktop dev
```
验证：
1. 跑一句"我上不了网，帮我看看"，看活动时间线里若出现"记住"步骤显示为思考态（不是修复）。
2. 设置 → "打开记忆文件" → 默认编辑器打开 `openfix-memory.md`，能看到自动记下的机器事实（如 `en7=AX88179B`）。
3. 关掉重开 App，再问相关问题，确认它引用了记住的事实（少重复诊断）。

- [ ] **Step 3: 推送**

```bash
git push origin main
```

---

## 验收标准

- core 新增模块/工具/接入全部单测通过；`looksSensitive` 拦截敏感、`applyMemory` 分节+去重正确、`composeMemoryInjection` 空不注入。
- 运行时记忆注入 system、`remember` 工具可被模型调用并落盘到 `userData/openfix-memory.md`。
- 记忆文件人类可读、可手动编辑；设置里一键打开。
- 隐私：敏感内容在 core（工具+applyMemory）双重拦截，不写、不上云。
- 记忆失败（读/写）绝不阻断主流程。
