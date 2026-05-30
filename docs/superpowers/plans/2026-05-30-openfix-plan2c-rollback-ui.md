# OpenFix Plan 2c：GUI 落地"我改了啥 / 一键还原" 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 2a/2b 的安全闭环在 GUI 里落地——成功修复后显示"我改了啥"并提供"一键还原"按钮；失败自动还原的情况如实呈现。打通后即可在真实窗口里安全地"改 DNS → 复测 → 一键撤销"。

**Architecture:** rollback 是闭包、不能跨 IPC 序列化，所以让 **main 进程持有每次运行的 `ChangeLog`**（通过 `runAgent` 的 `deps.changeLog` 注入），渲染层只拿可序列化的 `changes` 摘要展示；"一键还原"按钮走新 IPC `agent:rollback`，在 main 里调 `changeLog.rollbackAll()`。core 仅需让 `runAgent` 接受注入的 `ChangeLog` 并导出该类。

**Tech Stack:** TypeScript · Electron IPC · React + RTL · Vitest。

> **范围（No silent caps）：** 做"成功修复的 changes 展示 + 一键还原 + 失败自动还原的呈现"。**不含不可逆操作的硬确认弹窗**——目前没有任何不可逆写工具（`set_dns` 是可逆的），按 YAGNI 推迟到真正新增不可逆工具的计划里再做（`WriteToolContext.confirm` 接口已就位）。一次只保留"最近一次运行"的可还原改动。

---

## File Structure

```
packages/core/src/
├── run-agent.ts            # deps 增加 changeLog?（注入）（修改）
├── run-agent.test.ts       # 加：注入 changeLog 用例（修改）
└── index.ts                # 导出 ChangeLog 类（修改）
apps/desktop/src/
├── main/index.ts           # 持有 rollback 句柄；agent:run 注入 changeLog；新 agent:rollback（修改）
├── preload/index.ts        # 暴露 rollback + 扩展 runAgent 返回类型（修改）
├── preload/index.d.ts      # window.api 类型加 changes/rolledBack/rollback（修改）
└── renderer/src/
    ├── App.tsx             # 改动面板 + 一键还原（修改）
    └── App.test.tsx        # 加：展示 changes + 点还原（修改）
```

---

## Task 1: core —— runAgent 接受注入的 ChangeLog（TDD）

**Files:**
- Modify: `packages/core/src/run-agent.ts`
- Modify: `packages/core/src/run-agent.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 在 `run-agent.test.ts` 顶部 import 区加 `ChangeLog` 导入，并在最外层 describe 末尾（最后一个 `})` 前）加用例**

import 区加（与现有 import 并列）：

```ts
import { ChangeLog } from './safety/change-log'
```

用例：

```ts
  it('可注入 changeLog：成功修复后改动留在注入的账本里（供会话级还原）', async () => {
    const { shell } = mkShell(0) // 复测通过
    const model = scripted([
      { tool: { name: 'set_dns_servers', input: { service: 'Wi-Fi', servers: ['1.1.1.1'] } } },
      { tool: { name: 'verify_connectivity', input: { host: '8.8.8.8' } } },
      { text: '修好了。' }
    ])
    const changeLog = new ChangeLog()
    const result = await runAgent('网连不上', { model, shell, changeLog })
    expect(result.rolledBack).toBe(false)
    expect(changeLog.list()).toHaveLength(1) // 改动留在外部注入的账本
  })
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: FAIL —— 注入的 `changeLog` 被忽略（内部新建），`changeLog.list()` 为空。

- [ ] **Step 3: 改 `packages/core/src/run-agent.ts`**

`RunAgentDeps` 加一项：

```ts
export interface RunAgentDeps {
  model?: LanguageModel
  tools?: ToolSet
  /** 注入 shell（测试用 mock，避免真实系统改动）；不传则用 runReadOnly。 */
  shell?: ShellRunner
  /** 注入 ChangeLog（main 进程持有，供运行结束后用户"一键还原"）；不传则内部新建。 */
  changeLog?: ChangeLog
}
```

函数体里把

```ts
  const changeLog = new ChangeLog()
```

改为

```ts
  const changeLog = deps.changeLog ?? new ChangeLog()
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: PASS（原 6 + 新 1 = 7 用例）。

- [ ] **Step 5: 导出 ChangeLog 类 —— 改 `packages/core/src/index.ts` 为：**

```ts
export { runAgent } from './run-agent.js'
export type { AgentResult, RunAgentDeps, ChatMessage } from './run-agent.js'
export type { ShellResult, ShellRunner } from './shell.js'
export { ChangeLog } from './safety/change-log.js'
export type { ChangeSummary, RiskLevel } from './safety/change-log.js'
```

- [ ] **Step 6: 构建 core + 全量测试**

Run: `pnpm --filter @openfix/core build && pnpm --filter @openfix/core test`
Expected: 无错；全 PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/run-agent.ts packages/core/src/run-agent.test.ts packages/core/src/index.ts
git commit -m "feat(core): runAgent 接受注入的 ChangeLog 并导出 ChangeLog 类"
```

---

## Task 2: IPC —— main 持有 rollback 句柄 + agent:rollback 通道

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/preload/index.d.ts`

> IPC 难以纯单测，本任务靠 typecheck + Task 3 的 GUI 测试（mock window.api）+ 最后手动端到端验证。

- [ ] **Step 1: 改 `apps/desktop/src/main/index.ts`**

把顶部 import 改为同时引入 `ChangeLog`：

```ts
import { runAgent, ChangeLog } from '@openfix/core'
```

把原来的 `agent:run` handler 替换为下面（新增 rollback 句柄状态 + agent:rollback）：

```ts
  // OpenFix：main 进程持有"最近一次运行"的还原句柄（rollback 是闭包，不能跨 IPC 序列化）
  let currentRollback: (() => Promise<void>) | null = null

  ipcMain.handle(
    'agent:run',
    async (_event, messages: { role: 'user' | 'assistant'; content: string }[]) => {
      const changeLog = new ChangeLog()
      const result = await runAgent(messages, { changeLog })
      // 成功且有改动 → 留还原句柄；失败(已自动还原)或无改动 → 清空
      currentRollback =
        !result.rolledBack && result.changes.length > 0 ? () => changeLog.rollbackAll() : null
      return result
    }
  )

  ipcMain.handle('agent:rollback', async () => {
    if (!currentRollback) return { ok: false }
    await currentRollback()
    currentRollback = null
    return { ok: true }
  })
```

- [ ] **Step 2: 改 `apps/desktop/src/preload/index.ts` 的 `api`**

```ts
const api = {
  runAgent: (
    messages: { role: 'user' | 'assistant'; content: string }[]
  ): Promise<{
    text: string
    toolCalls: { toolName: string; input: unknown }[]
    changes: { id: number; description: string; riskLevel: 'reversible' | 'irreversible' }[]
    rolledBack: boolean
  }> => ipcRenderer.invoke('agent:run', messages),
  rollback: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('agent:rollback')
}
```

- [ ] **Step 3: 改 `apps/desktop/src/preload/index.d.ts` 的 `api` 类型**

```ts
    api: {
      runAgent: (
        messages: { role: 'user' | 'assistant'; content: string }[]
      ) => Promise<{
        text: string
        toolCalls: { toolName: string; input: unknown }[]
        changes: { id: number; description: string; riskLevel: 'reversible' | 'irreversible' }[]
        rolledBack: boolean
      }>
      rollback: () => Promise<{ ok: boolean }>
    }
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @openfix/desktop typecheck`
Expected: 无错（确认 `ChangeLog` 从 `@openfix/core` 可导入、类型对齐）。

> 若报 `ChangeLog` 找不到：确认 Task 1 已 `pnpm --filter @openfix/core build`（desktop 依赖 core 的 dist）。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/preload/index.d.ts
git commit -m "feat(desktop): IPC agent:rollback + main 持有还原句柄"
```

---

## Task 3: GUI —— 改动面板 + 一键还原（TDD）

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/App.test.tsx`

- [ ] **Step 1: 在 `App.test.tsx` 的 `beforeEach` 里给 mock 的 runAgent 补上 changes/rolledBack，并加 rollback mock；再加一个测试**

把 `beforeEach` 替换为：

```ts
beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    runAgent: vi.fn().mockResolvedValue({
      text: '你的网络是通的。',
      toolCalls: [],
      changes: [],
      rolledBack: false
    }),
    rollback: vi.fn().mockResolvedValue({ ok: true })
  }
})
```

在 describe 末尾加用例：

```ts
  it('有改动时展示"我改了啥"并能一键还原', async () => {
    ;(window.api.runAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: '已把 DNS 改成 1.1.1.1。',
      toolCalls: [],
      changes: [{ id: 1, description: '把 Wi-Fi 的 DNS 设为 1.1.1.1', riskLevel: 'reversible' }],
      rolledBack: false
    })
    render(<App />)
    fireEvent.change(screen.getByLabelText('问题描述'), { target: { value: '上不了网' } })
    fireEvent.keyDown(screen.getByLabelText('问题描述'), { key: 'Enter' })

    // 改动摘要出现
    await waitFor(() => expect(screen.getByText(/把 Wi-Fi 的 DNS 设为 1\.1\.1\.1/)).toBeInTheDocument())
    // 点一键还原
    fireEvent.click(screen.getByText('一键还原'))
    await waitFor(() => expect(window.api.rollback).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('已还原')).toBeInTheDocument())
  })
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @openfix/desktop test`
Expected: FAIL —— 找不到改动摘要 / "一键还原" 按钮（App 还没渲染面板）。

- [ ] **Step 3: 改 `apps/desktop/src/renderer/src/App.tsx`**

整文件替换为（在原对话式基础上加：记录最近一次的 changes、渲染改动面板、还原按钮）：

```tsx
import { useEffect, useRef, useState } from 'react'
import './App.css'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChangeSummary {
  id: number
  description: string
  riskLevel: 'reversible' | 'irreversible'
}

function App(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [changes, setChanges] = useState<ChangeSummary[]>([])
  const [reverted, setReverted] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, loading])

  async function handleSubmit(): Promise<void> {
    const text = input.trim()
    if (!text || loading) return
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(history)
    setInput('')
    setLoading(true)
    setChanges([])
    setReverted(false)
    try {
      const res = await window.api.runAgent(history)
      setMessages((prev) => [...prev, { role: 'assistant', content: res.text }])
      if (!res.rolledBack && res.changes.length > 0) setChanges(res.changes)
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `出错了：${(e as Error).message}` }
      ])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  async function handleRollback(): Promise<void> {
    const res = await window.api.rollback()
    if (res.ok) {
      setReverted(true)
      setChanges([])
    }
  }

  return (
    <div className="chat">
      <header className="chat__header">OpenFix</header>

      <div className="chat__log" ref={logRef} aria-label="对话">
        {messages.length === 0 && (
          <p className="chat__empty">说说你的电脑/网络问题，比如：我连不上网</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg--${m.role}`}>
            <pre className="msg__content">{m.content}</pre>
          </div>
        ))}
        {loading && (
          <div className="msg msg--assistant">
            <span className="msg__typing">排查中…</span>
          </div>
        )}
      </div>

      {changes.length > 0 && (
        <div className="changes" aria-label="本次改动">
          <div className="changes__title">我改了这些（可还原）：</div>
          <ul className="changes__list">
            {changes.map((c) => (
              <li key={c.id}>{c.description}</li>
            ))}
          </ul>
          <button className="changes__undo" onClick={() => void handleRollback()}>
            一键还原
          </button>
        </div>
      )}
      {reverted && <div className="changes changes--reverted">已还原</div>}

      <div className="chat__input">
        <textarea
          aria-label="问题描述"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="回车发送，Shift+Enter 换行"
          rows={2}
        />
        <button onClick={() => void handleSubmit()} disabled={loading || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 4: 给改动面板加样式 —— 在 `apps/desktop/src/renderer/src/App.css` 末尾追加**

```css
.changes {
  margin: 0 12px 8px;
  padding: 10px 12px;
  border: 1px solid rgba(47, 111, 237, 0.4);
  border-radius: 8px;
  background: rgba(47, 111, 237, 0.08);
  font-size: 13px;
}

.changes__title {
  font-weight: 600;
  margin-bottom: 4px;
}

.changes__list {
  margin: 0 0 8px;
  padding-left: 18px;
}

.changes__undo {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid #2f6fed;
  background: transparent;
  color: #2f6fed;
  cursor: pointer;
}

.changes--reverted {
  color: #2a8a4a;
  border-color: rgba(42, 138, 74, 0.4);
  background: rgba(42, 138, 74, 0.08);
}
```

- [ ] **Step 5: 运行，确认通过**

Run: `pnpm --filter @openfix/desktop test`
Expected: PASS（原 2 + 新 1 = 3 用例）。

- [ ] **Step 6: typecheck + build + 全量测试**

Run: `pnpm --filter @openfix/desktop typecheck && pnpm --filter @openfix/desktop build && pnpm -r test`
Expected: 无错；全 PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.test.tsx apps/desktop/src/renderer/src/App.css
git commit -m "feat(desktop): 改动面板 + 一键还原 GUI"
```

---

## Task 4: 端到端手动验证（真改 DNS → 复测 → 一键还原）

**Files:** 无新增。第一次在真实窗口里真正"修+还原"。

- [ ] **Step 1: 启动**

Run: `pnpm --filter @openfix/core build && pnpm --filter @openfix/desktop dev`

- [ ] **Step 2: 触发一次可逆修复**

在窗口输入类似：`帮我把 Wi-Fi 的 DNS 设成 1.1.1.1 试试`（或制造一个 DNS 问题让它自己修）。
Expected：
- 助手回复说明改了 DNS；
- 出现"我改了这些（可还原）"面板，列出"把 Wi-Fi 的 DNS 设为 1.1.1.1"，带"一键还原"按钮；
- 用 `networksetup -getdnsservers Wi-Fi`（终端）可见 DNS 确已改。
- 若改完复测不通，助手会说明"已自动还原"，且不出现还原面板。

- [ ] **Step 3: 一键还原并核对**

点"一键还原" → 出现"已还原"。终端 `networksetup -getdnsservers Wi-Fi` 确认 DNS 恢复原值。

- [ ] **Step 4: 记录观察**

把真实表现（含 macOS 改 DNS 是否需要管理员、复测/还原是否如期）记到 `docs/` 或本计划同名 -NOTES.md。

> ⚠️ 本任务会真实修改本机 DNS（可逆）。务必用"一键还原"或终端 `networksetup -setdnsservers Wi-Fi Empty` 复原。

---

## Self-Review（对照 spec）

**1. Spec 覆盖（安全模型 · 事后透明）：**
- "事后透明：不打断你，但给'我做了啥 + 一键还原'" → 改动面板 + 一键还原（Task 3）✅
- "可回滚（用户侧）" → main 持有 ChangeLog + `agent:rollback`（Task 2），core 支持注入（Task 1）✅
- "失败自动还原如实呈现" → `rolledBack` 时不显示还原面板，助手文案已含还原说明（2b + Task 3）✅
- **不覆盖（YAGNI 推迟）**：不可逆操作硬确认弹窗——当前无不可逆工具，`confirm` 接口已就位，待新增此类工具时再做。

**2. 占位符扫描：** 无 TBD/TODO；代码与命令完整。✅

**3. 类型一致性：** renderer 的 `ChangeSummary{id,description,riskLevel}` 与 core `ChangeSummary`、preload 返回类型三处字段一致；`window.api.runAgent` 返回含 `changes/rolledBack`、`window.api.rollback(): Promise<{ok}>` 在 preload.ts / preload.d.ts / App.tsx 三处一致；main 导入 `ChangeLog`（值）依赖 Task1 的 index 导出。✅
