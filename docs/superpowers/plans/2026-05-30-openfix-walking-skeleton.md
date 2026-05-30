# OpenFix Walking Skeleton 实现计划（Plan 1 / M1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭出 OpenFix 的最小可运行垂直切片——在 macOS 上输入一句话（如"我连不上网"），Electron+React 界面调用引擎，引擎用模型无关的 agent loop 真的调一个只读网络工具、把结论用大白话显示出来。

**Architecture:** pnpm monorepo（参考 MoonshotAI/kimi-code 的 library-first 分层）：`packages/core` 是引擎（agent loop + 工具 + LLM provider，纯 TS、可独立单测），`apps/desktop` 是 Electron+React 壳（main 进程经 IPC 调引擎）。本计划只做"只读诊断 + 显示结论"，不含写操作/安全闸/快照——那些是 Plan 2。

**Tech Stack:** TypeScript · pnpm workspace · Vercel AI SDK（`ai` + `@ai-sdk/openai-compatible`）· zod · Electron + electron-vite + React · Vitest（+ React Testing Library）· Node ≥ 20。

> **范围说明（No silent caps）：** 本计划把唯一的只读网络工具临时放在 `packages/core/src/tools/` 里当内置工具。可插拔"技能包"机制（`packages/skill-network` + 向 core 注册）是 **Plan 3** 才引入，届时把网络工具迁过去。安全闸/快照/回滚/验证器是 **Plan 2**。

---

## File Structure

```
openfix/
├── package.json                         # 根：pnpm workspace + 顶层脚本
├── pnpm-workspace.yaml                  # 工作区定义
├── tsconfig.base.json                   # 共享 TS 配置
├── packages/
│   └── core/
│       ├── package.json                 # @openfix/core
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── shell.ts                 # runReadOnly：只读跑命令
│           ├── shell.test.ts
│           ├── tools/
│           │   ├── network.ts           # check_connectivity 只读工具（含 DI）
│           │   └── network.test.ts
│           ├── llm.ts                   # getModel：从 env 建模型无关 provider
│           ├── llm.test.ts
│           ├── run-agent.ts             # runAgent：薄 agent loop
│           ├── run-agent.test.ts
│           └── index.ts                 # 导出 runAgent / 类型
└── apps/
    └── desktop/                         # electron-vite React-TS 脚手架（含改动）
        ├── package.json                 # @openfix/desktop，依赖 @openfix/core
        ├── .env.example                 # LLM 配置样例
        ├── electron.vite.config.ts
        ├── vitest.config.ts             # 渲染层测试（jsdom）
        ├── vitest.setup.ts
        └── src/
            ├── main/index.ts            # 注册 ipcMain.handle('agent:run')
            ├── preload/index.ts         # 暴露 window.api.runAgent
            ├── preload/index.d.ts       # window.api 类型
            └── renderer/src/
                ├── App.tsx              # 输入框 + 结果展示
                └── App.test.tsx
```

每个文件单一职责：`shell` 只管"安全地跑只读命令"；`tools/network` 只管"把命令输出解析成结构化结果"；`llm` 只管"按 env 造模型"；`run-agent` 只管"驱动 loop"；`index` 只管"对外导出"。`apps/desktop` 只管"壳 + IPC + UI"。

---

## Task 1: 根 monorepo 骨架

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`

> 注：仓库根目录已存在（含 `docs/`、`.gitignore`、`.git`）。本任务只新增上述 3 个文件。

- [ ] **Step 1: 创建 `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

- [ ] **Step 2: 创建根 `package.json`**

```json
{
  "name": "openfix",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "build:core": "pnpm --filter @openfix/core build",
    "dev": "pnpm --filter @openfix/desktop dev"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 3: 创建 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 4: 安装并验证工作区**

Run: `pnpm install`
Expected: 成功，无 workspace 错误（此时还没有子包，安装应正常完成）。

- [ ] **Step 5: 提交**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json pnpm-lock.yaml
git commit -m "chore: 初始化 pnpm monorepo 骨架"
```

---

## Task 2: `packages/core` 包 + 只读 shell runner（TDD）

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/shell.ts`
- Test: `packages/core/src/shell.test.ts`

- [ ] **Step 1: 创建 `packages/core/package.json`**

```json
{
  "name": "@openfix/core",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "ai": "^5.0.0",
    "@ai-sdk/openai-compatible": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: 创建 `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: 创建 `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
```

- [ ] **Step 4: 安装依赖**

Run: `pnpm install`
Expected: `@openfix/core` 的依赖装好。

- [ ] **Step 5: 写失败测试 `packages/core/src/shell.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { runReadOnly } from './shell'

describe('runReadOnly', () => {
  it('返回命令的 stdout 和 code=0', async () => {
    const r = await runReadOnly('echo', ['hello'])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('hello\n')
  })

  it('非零退出码原样返回，不抛异常', async () => {
    const r = await runReadOnly('sh', ['-c', 'exit 3'])
    expect(r.code).toBe(3)
  })
})
```

- [ ] **Step 6: 运行测试，确认失败**

Run: `pnpm --filter @openfix/core test`
Expected: FAIL —— `Failed to resolve import "./shell"` 或 `runReadOnly is not a function`。

- [ ] **Step 7: 实现 `packages/core/src/shell.ts`**

```ts
import { execFile } from 'node:child_process'

export interface ShellResult {
  code: number
  stdout: string
  stderr: string
}

/** 只读地执行一个命令。永不抛异常——把退出码原样返回，便于上层判断。 */
export type ShellRunner = (
  cmd: string,
  args: string[],
  timeoutMs?: number
) => Promise<ShellResult>

export const runReadOnly: ShellRunner = (cmd, args, timeoutMs = 5000) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const errCode = (err as NodeJS.ErrnoException | null)?.code
      const code = typeof errCode === 'number' ? errCode : err ? 1 : 0
      resolve({
        code,
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? ''
      })
    })
  })
```

- [ ] **Step 8: 运行测试，确认通过**

Run: `pnpm --filter @openfix/core test`
Expected: PASS（2 个用例）。

- [ ] **Step 9: 提交**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): 只读 shell runner runReadOnly"
```

---

## Task 3: 只读网络工具 `check_connectivity`（TDD）

**Files:**
- Create: `packages/core/src/tools/network.ts`
- Test: `packages/core/src/tools/network.test.ts`

工具用依赖注入接收 `ShellRunner`，这样测试可注入假的 runner、不打真网络。

- [ ] **Step 1: 写失败测试 `packages/core/src/tools/network.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import type { ShellResult } from '../shell'
import { createNetworkTools } from './network'

const okOptions = { toolCallId: 't1', messages: [] } as never

describe('check_connectivity', () => {
  it('ping 成功时解析出 reachable 与延迟', async () => {
    const fakePing: ShellResult = {
      code: 0,
      stdout: '64 bytes from 8.8.8.8: icmp_seq=0 ttl=117 time=12.3 ms',
      stderr: ''
    }
    const tools = createNetworkTools(async () => fakePing)
    const res = await tools.check_connectivity.execute!({ host: '8.8.8.8' }, okOptions)
    expect(res).toMatchObject({ host: '8.8.8.8', reachable: true, latencyMs: 12.3 })
  })

  it('ping 失败时 reachable=false、延迟为 null', async () => {
    const fakePing: ShellResult = { code: 2, stdout: 'Request timeout', stderr: '' }
    const tools = createNetworkTools(async () => fakePing)
    const res = await tools.check_connectivity.execute!({ host: '10.0.0.99' }, okOptions)
    expect(res).toMatchObject({ host: '10.0.0.99', reachable: false, latencyMs: null })
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @openfix/core test src/tools/network.test.ts`
Expected: FAIL —— 找不到 `./network` / `createNetworkTools`。

- [ ] **Step 3: 实现 `packages/core/src/tools/network.ts`**

```ts
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { ShellRunner } from '../shell'

/** 用注入的 shell runner 造出网络只读工具集（macOS：ping -c 1 -t 3）。 */
export function createNetworkTools(shell: ShellRunner): ToolSet {
  return {
    check_connectivity: tool({
      description:
        '测试本机到某主机的网络连通性（只读，不改动任何配置）。返回是否可达与往返延迟。',
      inputSchema: z.object({
        host: z.string().describe('要测试的主机名或 IP，例如 8.8.8.8 或 www.apple.com')
      }),
      execute: async ({ host }) => {
        const r = await shell('ping', ['-c', '1', '-t', '3', host], 6000)
        const reachable = r.code === 0
        const m = r.stdout.match(/time[=<]([\d.]+)\s*ms/)
        const latencyMs = m ? Number(m[1]) : null
        return { host, reachable, latencyMs, raw: (r.stdout || r.stderr).trim() }
      }
    })
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @openfix/core test src/tools/network.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/tools
git commit -m "feat(core): check_connectivity 只读网络工具"
```

---

## Task 4: 模型无关 LLM provider（TDD）

**Files:**
- Create: `packages/core/src/llm.ts`
- Test: `packages/core/src/llm.test.ts`

- [ ] **Step 1: 写失败测试 `packages/core/src/llm.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { getModel } from './llm'

const KEYS = ['OPENFIX_LLM_BASE_URL', 'OPENFIX_LLM_API_KEY', 'OPENFIX_LLM_MODEL'] as const

function clearEnv(): void {
  for (const k of KEYS) delete process.env[k]
}

afterEach(clearEnv)

describe('getModel', () => {
  it('缺少任一配置时抛出清晰错误', () => {
    clearEnv()
    process.env.OPENFIX_LLM_BASE_URL = 'https://example.com/v1'
    expect(() => getModel()).toThrow(/OPENFIX_LLM/)
  })

  it('配置齐全时返回一个模型对象', () => {
    process.env.OPENFIX_LLM_BASE_URL = 'https://example.com/v1'
    process.env.OPENFIX_LLM_API_KEY = 'sk-test'
    process.env.OPENFIX_LLM_MODEL = 'gpt-test'
    const model = getModel()
    expect(model).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @openfix/core test src/llm.test.ts`
Expected: FAIL —— 找不到 `./llm` / `getModel`。

- [ ] **Step 3: 实现 `packages/core/src/llm.ts`**

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

/** 按 env 造一个 OpenAI 兼容的模型（baseURL/key/model 都可换，保证模型无关）。 */
export function getModel(): LanguageModel {
  const baseURL = process.env.OPENFIX_LLM_BASE_URL
  const apiKey = process.env.OPENFIX_LLM_API_KEY
  const modelId = process.env.OPENFIX_LLM_MODEL
  if (!baseURL || !apiKey || !modelId) {
    throw new Error(
      '缺少 LLM 配置：请在 .env 设置 OPENFIX_LLM_BASE_URL / OPENFIX_LLM_API_KEY / OPENFIX_LLM_MODEL'
    )
  }
  const provider = createOpenAICompatible({ name: 'openfix-llm', baseURL, apiKey })
  return provider(modelId)
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @openfix/core test src/llm.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/llm.ts packages/core/src/llm.test.ts
git commit -m "feat(core): 模型无关的 getModel（OpenAI 兼容，env 可换）"
```

---

## Task 5: 薄 agent loop `runAgent`（TDD，用 MockLanguageModelV2）+ 包导出

**Files:**
- Create: `packages/core/src/run-agent.ts`
- Test: `packages/core/src/run-agent.test.ts`
- Create: `packages/core/src/index.ts`

> **版本注**：若安装的 `ai` 已把 `MockLanguageModelV2` 改名为 `MockLanguageModelV3`，把 import 与类名一并替换即可，`content`/`finishReason`/`usage` 字段形状一致。`ai/test` 只能在测试里 import（运行期 import 会因内置 vitest 依赖报错）。

- [ ] **Step 1: 写失败测试 `packages/core/src/run-agent.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { MockLanguageModelV2 } from 'ai/test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { runAgent } from './run-agent'

describe('runAgent', () => {
  it('先调工具、再把结论用文字返回', async () => {
    // mock 模型：第 1 次返回工具调用，第 2 次返回文字结论
    let call = 0
    const model = new MockLanguageModelV2({
      doGenerate: async () => {
        call += 1
        if (call === 1) {
          return {
            finishReason: 'tool-calls' as const,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: 'call-1',
                toolName: 'check_connectivity',
                input: JSON.stringify({ host: '8.8.8.8' })
              }
            ],
            warnings: []
          }
        }
        return {
          finishReason: 'stop' as const,
          usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          content: [{ type: 'text' as const, text: '你和 8.8.8.8 是通的，延迟约 12.3ms。' }],
          warnings: []
        }
      }
    })

    const executedHosts: string[] = []
    const tools: ToolSet = {
      check_connectivity: tool({
        description: '测试连通性',
        inputSchema: z.object({ host: z.string() }),
        execute: async ({ host }) => {
          executedHosts.push(host)
          return { host, reachable: true, latencyMs: 12.3 }
        }
      })
    }

    const result = await runAgent('我连不上网', { model, tools })

    expect(executedHosts).toEqual(['8.8.8.8'])
    expect(result.toolCalls).toEqual([
      { toolName: 'check_connectivity', input: { host: '8.8.8.8' } }
    ])
    expect(result.text).toContain('8.8.8.8')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: FAIL —— 找不到 `./run-agent` / `runAgent`。

- [ ] **Step 3: 实现 `packages/core/src/run-agent.ts`**

```ts
import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai'
import { getModel } from './llm'
import { runReadOnly } from './shell'
import { createNetworkTools } from './tools/network'

export interface RunAgentDeps {
  model?: LanguageModel
  tools?: ToolSet
}

export interface AgentResult {
  text: string
  toolCalls: Array<{ toolName: string; input: unknown }>
}

const SYSTEM_PROMPT = `你是 OpenFix，帮普通人排查电脑网络问题的助手。
目前只有"只读诊断"工具，不会改动任何系统配置。
请先用工具查清实际情况，再用简短的大白话把结论告诉用户。不要假装执行了修复。`

/** 薄 agent loop：默认用 env 模型 + 内置网络工具；测试可注入 model/tools。 */
export async function runAgent(userText: string, deps: RunAgentDeps = {}): Promise<AgentResult> {
  const model = deps.model ?? getModel()
  const tools = deps.tools ?? createNetworkTools(runReadOnly)

  const result = await generateText({
    model,
    tools,
    system: SYSTEM_PROMPT,
    prompt: userText,
    stopWhen: stepCountIs(5)
  })

  return {
    text: result.text,
    toolCalls: result.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input }))
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @openfix/core test src/run-agent.test.ts`
Expected: PASS（1 个用例；执行了工具且返回含 "8.8.8.8" 的文字）。

- [ ] **Step 5: 创建包入口 `packages/core/src/index.ts`**

```ts
export { runAgent } from './run-agent'
export type { AgentResult, RunAgentDeps } from './run-agent'
export type { ShellResult, ShellRunner } from './shell'
```

- [ ] **Step 6: 构建并全量测试 core**

Run: `pnpm --filter @openfix/core build && pnpm --filter @openfix/core test`
Expected: 构建生成 `packages/core/dist/`；全部测试 PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/run-agent.ts packages/core/src/run-agent.test.ts packages/core/src/index.ts
git commit -m "feat(core): 薄 agent loop runAgent + 包导出"
```

---

## Task 6: 脚手架 `apps/desktop`（Electron + React + TS）并接入工作区

**Files:**
- Create: `apps/desktop/**`（electron-vite 脚手架生成）
- Modify: `apps/desktop/package.json`

> 这是 setup 任务，无单测，靠"能启动窗口"验证。

- [ ] **Step 1: 用 electron-vite 脚手架生成 desktop 应用**

```bash
mkdir -p apps && cd apps
npm create @quick-start/electron@latest desktop
```
交互选择：**Framework = React**，**Variant = TypeScript**。生成目录 `apps/desktop/`。生成后 `cd ../..` 回到仓库根。

- [ ] **Step 2: 把 desktop 纳入工作区命名 + 依赖 core**

编辑 `apps/desktop/package.json`：把 `"name"` 改为 `"@openfix/desktop"`，并在 `dependencies` 加入两项：

```json
"@openfix/core": "workspace:*",
"dotenv": "^16.4.0"
```

并确认 `scripts` 中存在 electron-vite 的 `"dev"`（脚手架默认有 `"dev": "electron-vite dev"`，若名称不同则改为此）。

- [ ] **Step 3: 安装并构建 core（desktop 依赖其 dist）**

Run: `pnpm install && pnpm --filter @openfix/core build`
Expected: 工作区链接成功，`@openfix/core` 已构建出 `dist/`。

- [ ] **Step 4: 启动验证（脚手架原样窗口）**

Run: `pnpm --filter @openfix/desktop dev`
Expected: 弹出 Electron 窗口，显示脚手架默认页面，无报错。确认后关闭。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop pnpm-lock.yaml
git commit -m "chore(desktop): electron-vite React-TS 脚手架并接入工作区"
```

---

## Task 7: IPC 打通——main 调引擎、preload 暴露、env 加载

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/preload/index.d.ts`
- Create: `apps/desktop/.env.example`

> IPC/Electron 难以纯单测，本任务靠 Task 9 的端到端手动验证。这里只做接线。

- [ ] **Step 1: main 进程加载 env 并注册 IPC handler**

在 `apps/desktop/src/main/index.ts` **文件顶部第一行**加入（先于其它 import 执行）：

```ts
import 'dotenv/config'
```

在该文件已有的 `import { app, BrowserWindow } from 'electron'` 处，补上 `ipcMain`：

```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { runAgent } from '@openfix/core'
```

在 `app.whenReady().then(() => { ... })` 回调内、创建窗口之前，注册 handler：

```ts
ipcMain.handle('agent:run', async (_event, userText: string) => {
  return runAgent(userText)
})
```

- [ ] **Step 2: preload 暴露 `window.api.runAgent`**

把 `apps/desktop/src/preload/index.ts` 中向渲染层暴露 API 的部分改为（脚手架已有 `contextBridge`/`electronAPI`，在其旁追加 `api`）：

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  runAgent: (text: string): Promise<{ text: string; toolCalls: { toolName: string; input: unknown }[] }> =>
    ipcRenderer.invoke('agent:run', text)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
```

- [ ] **Step 3: 给渲染层补 `window.api` 类型**

把 `apps/desktop/src/preload/index.d.ts` 改为：

```ts
import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      runAgent: (
        text: string
      ) => Promise<{ text: string; toolCalls: { toolName: string; input: unknown }[] }>
    }
  }
}

export {}
```

- [ ] **Step 4: 创建 `apps/desktop/.env.example`**

```bash
# OpenFix 本地模型配置（复制为 .env 并填入真实值；.env 已被 gitignore）
OPENFIX_LLM_BASE_URL=https://your-openai-compatible-endpoint/v1
OPENFIX_LLM_API_KEY=sk-xxxx
OPENFIX_LLM_MODEL=your-model-id
```

- [ ] **Step 5: 类型检查通过**

Run: `pnpm --filter @openfix/desktop typecheck`
（若脚手架未提供 `typecheck` 脚本，用 `pnpm --filter @openfix/desktop exec tsc --noEmit -p tsconfig.node.json` 与渲染层对应的 tsconfig 分别检查；以脚手架实际 tsconfig 名为准。）
Expected: 无类型错误。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src apps/desktop/.env.example
git commit -m "feat(desktop): IPC 打通 main→runAgent，preload 暴露 window.api"
```

---

## Task 8: 渲染层 UI（TDD，React Testing Library）

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Create: `apps/desktop/src/renderer/src/App.test.tsx`
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/vitest.setup.ts`
- Modify: `apps/desktop/package.json`（加测试依赖与脚本）

- [ ] **Step 1: 加渲染层测试依赖与脚本**

在 `apps/desktop/package.json` 的 `devDependencies` 加入：

```json
"vitest": "^2.1.0",
"jsdom": "^25.0.0",
"@testing-library/react": "^16.0.0",
"@testing-library/jest-dom": "^6.5.0"
```

在 `scripts` 加入：

```json
"test": "vitest run"
```

然后 Run: `pnpm install`

- [ ] **Step 2: 创建 `apps/desktop/vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 3: 创建 `apps/desktop/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/renderer/**/*.test.tsx']
  }
})
```

> `@vitejs/plugin-react` 已由 electron-vite React 脚手架带入；若未带，`pnpm --filter @openfix/desktop add -D @vitejs/plugin-react`。

- [ ] **Step 4: 写失败测试 `apps/desktop/src/renderer/src/App.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from './App'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    runAgent: vi.fn().mockResolvedValue({ text: '你的网络是通的。', toolCalls: [] })
  }
})

describe('App', () => {
  it('提交问题后调用引擎并展示返回的结论', async () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('问题描述'), { target: { value: '我连不上网' } })
    fireEvent.click(screen.getByText('开始排查'))

    await waitFor(() =>
      expect(screen.getByLabelText('结果')).toHaveTextContent('你的网络是通的。')
    )
    expect(window.api.runAgent).toHaveBeenCalledWith('我连不上网')
  })
})
```

- [ ] **Step 5: 运行测试，确认失败**

Run: `pnpm --filter @openfix/desktop test`
Expected: FAIL —— App 还是脚手架内容，找不到 `问题描述` / `开始排查`。

- [ ] **Step 6: 实现 `apps/desktop/src/renderer/src/App.tsx`**

```tsx
import { useState } from 'react'

function App(): JSX.Element {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')

  async function handleSubmit(): Promise<void> {
    if (!input.trim() || loading) return
    setLoading(true)
    setResult('')
    try {
      const res = await window.api.runAgent(input)
      setResult(res.text)
    } catch (e) {
      setResult(`出错了：${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <h1>OpenFix</h1>
      <textarea
        aria-label="问题描述"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="说说你的问题，比如：我连不上网"
      />
      <button onClick={handleSubmit} disabled={loading}>
        {loading ? '排查中…' : '开始排查'}
      </button>
      {result && <pre aria-label="结果">{result}</pre>}
    </div>
  )
}

export default App
```

> 若脚手架的 `App.tsx` 顶部有引入示例资源/样式的 import 导致报错，一并删除；本文件即新的完整内容。

- [ ] **Step 7: 运行测试，确认通过**

Run: `pnpm --filter @openfix/desktop test`
Expected: PASS（1 个用例）。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/renderer apps/desktop/vitest.config.ts apps/desktop/vitest.setup.ts apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(desktop): 渲染层输入框+结果展示，含 RTL 测试"
```

---

## Task 9: 端到端手动验证（真模型 + 真 ping）

**Files:** 无新增。本任务把整条链路在真实环境跑通，并暴露 macOS 下 Electron 跑 shell 命令的权限现实。

- [ ] **Step 1: 配置真实 LLM**

```bash
cp apps/desktop/.env.example apps/desktop/.env
```
编辑 `apps/desktop/.env`，填入可用的 OpenAI 兼容端点 + key + 一个**支持工具调用**的 model id。

- [ ] **Step 2: 构建 core 并启动应用**

Run: `pnpm --filter @openfix/core build && pnpm --filter @openfix/desktop dev`
Expected: 窗口出现，显示 "OpenFix" 标题、输入框、"开始排查" 按钮。

- [ ] **Step 3: 跑一次真实排查**

在输入框输入：`测试我和 8.8.8.8 的连接`，点"开始排查"。
Expected：
- 几秒后结果区出现一句大白话结论（例如"你和 8.8.8.8 是通的，延迟约 X ms"）。
- 主进程终端无未捕获异常。
- 说明链路全通：渲染层 → IPC → runAgent → 模型决定调用 `check_connectivity` → 执行 `ping` → 模型据结果作答 → 显示。

- [ ] **Step 4: 记录 macOS 权限观察（写进 docs）**

若 `ping` 因权限/沙盒被拒，把现象与解决（如 entitlements / 关闭沙盒）记到 `apps/desktop` 的 README 或 `docs/` 笔记里——这是 M1 必须尽早暴露的风险点。
若一切正常，也记一句"dev 模式下 Electron 直接 execFile 系统命令无障碍"。

- [ ] **Step 5: 提交（如有文档/微调）**

```bash
git add -A
git commit -m "docs: 记录 walking skeleton 端到端验证与 macOS 权限观察"
```

---

## Self-Review（对照 spec 的自查结果）

**1. Spec 覆盖：**
- 模型无关引擎 → Task 4（`getModel` 经 env 可换）+ Task 5（`runAgent` 用 AI SDK）✅
- 自写薄 agent loop → Task 5 ✅
- 工具层（只读）→ Task 2（shell）+ Task 3（network）✅
- monorepo 分层（apps/packages，参考 kimi-code）→ Task 1/2/6 ✅
- Electron + React + TS、引擎在 main 进程 → Task 6/7 ✅
- 一句话交互的最小形态 → Task 8/9 ✅
- **本计划有意不覆盖**（留后续 plan）：安全闸 / 快照 / 回滚 / 验证器（Plan 2）；技能包插件机制与 `packages/skill-network`（Plan 3）；写操作工具；断网降级；打包/签名/公证。已在抬头"范围说明"显式声明，非遗漏。

**2. 占位符扫描：** 无 TBD/TODO；每个代码步骤含完整可运行代码；每个命令步骤含预期输出。✅

**3. 类型一致性：** `ShellRunner`/`ShellResult`（shell.ts）被 network.ts、index.ts 一致引用；`createNetworkTools` 返回 `ToolSet`，被 run-agent.ts 默认使用；`runAgent` 的 `AgentResult.toolCalls` 形状（`{toolName,input}`）在 run-agent 实现、其测试、preload 类型、App 调用四处一致；env 变量名 `OPENFIX_LLM_BASE_URL/API_KEY/MODEL` 在 llm.ts、llm.test.ts、.env.example 三处一致。✅

**已知外部不确定性（执行时留意，非计划缺陷）：**
- `ai`/`@ai-sdk/openai-compatible` 的次版本号请以 `pnpm add` 实际解析为准；API 面（`generateText`/`tool`/`stepCountIs`/`inputSchema`/`MockLanguageModelV2`）按本计划。
- electron-vite React-TS 脚手架的具体文件名（preload 的 `index.d.ts`、tsconfig 命名）以实际生成为准，按 Step 描述对号修改。
