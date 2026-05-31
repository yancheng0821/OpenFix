# OpenFix 轻量记忆 设计文档

> 状态：已通过设计评审，待出实现计划（writing-plans）。
> 日期：2026-05-31

## 目标

给 OpenFix 一个**本地、轻量、全自动**的记忆：记住这台机器的事实、用户偏好、过往修复，让"一句话搞定"更快（不必每次重新诊断同样的基本事实）、更懂用户。定位上服务"个人电脑助手"。

这是**通用机制**（agent 学"这台机器"的事实并存下来），不是把领域知识写死进 prompt——与项目的"不打地鼠"原则一致（见 `[[feedback_no_whack_a_mole]]`）。

## 已锁定的决策（来自脑暴问答）

1. **存什么**：机器事实 + 用户偏好 + 过往修复，三类合一存一个库。
2. **怎么写**：**全自动、静默**——agent 自己决定记什么（不弹确认、不需用户说"记住"）。
3. **可见性**：一个**可手动编辑的 markdown 文件**（CLAUDE.md 风格）+ 设置里一个"打开记忆文件"按钮。不做整套管理面板。
4. **隐私**：**只存非敏感信息**；明确不写密钥/账号密码/隐私路径——与现有白名单挡 `.ssh/.aws` 同一边界，且**代码强制**（不只靠 prompt）。
5. **写入触发**：**方案 A**——内联 `remember` 工具，agent 干活时顺手调用；不额外加"跑完抽取"的模型往返。

## 架构

一个本地 markdown 文件做记忆库。每次运行：

- **读**：把整个文件内容注入 system prompt（CLAUDE.md 那套）。
- **写**：agent 调用 `remember` 工具，静默追加。

文件 I/O 放在 **desktop 主进程**（与 `apps/desktop/src/main/config.ts` 同一模式），`packages/core` 保持平台无关——只通过 `deps.memory` 拿到「内容字符串 + 写回调」。

## 数据流

```
运行开始
  → 主进程 readMemory() 读文件内容（缺失/损坏 → 空串）
  → agent:run 传 deps.memory = { content, remember(entry) }
assembleRun
  → 把 content 注入 system（空则不注入）
  → 把 remember 工具加进工具集
agent 干活中学到耐久事实
  → 调 remember({ category, note })
  → core 先过 looksSensitive(note) 守卫：命中 → 不记，返回"出于隐私没记这条"
  → 未命中 → 调 deps.memory.remember(entry)
  → 主进程 appendMemory() 写文件（定位分节 + 精确去重）
```

## 组件设计

### 记忆文件 `userData/openfix-memory.md`

缺失时建脚手架：

```markdown
# OpenFix 记忆（自动维护，可手动编辑/删除）

## 机器事实

## 偏好

## 过往修复
```

注入 system 的文案（仅当文件非空）：

```
【关于这台机器和用户（你之前记下的）】
<文件内容>
（若其中某条已过时/与实际不符，以实际为准，并用 remember 更新。）
```

空文件 → 不注入任何内容（不制造噪音）。

### `remember` 工具（core）

- 入参：`{ category: 'machine' | 'preference' | 'fix', note: string }`
  - `machine` → `## 机器事实`，`preference` → `## 偏好`，`fix` → `## 过往修复`
- 执行：先 `looksSensitive(note)`；命中返回"出于隐私没记这条"，**不写**；否则调写回调，返回"已记住：<note>"。
- 走正常 tool-call → 自动出现在活动时间线（标签"记住"）。

### 隐私守卫 `looksSensitive(note)`（core，纯函数）

复用/对齐白名单的敏感正则：命中密码/密钥/token/`.ssh`/`.aws`/`.gnupg`/`id_rsa`/`id_ed25519`/`.pem`/`.key`/`credentials`/keychain 等即判敏感。放 core 便于单测，desktop 写入侧可再做一道兜底。

### 写入 `appendMemory(entry)`（desktop 主进程）

- 读现文件（无则用脚手架）→ 定位 category 对应分节标题 → 在其下追加 `- <note>`。
- **精确去重**：同一节里已存在相同（trim 后）行则跳过。
- 写回。失败吞掉（不影响主流程）。
- v1 不做自动清理/上限——staleness 靠 agent 见到实际情况后补更正 + 用户手动编辑文件。

### 注入与运行装配 `run-shared.ts`

- `RunDeps` 增 `memory?: { content: string; remember: (e: MemoryEntry) => Promise<void> }`。
- `assembleRun`：若 `deps.memory?.content` 非空，拼到 system（`BASE_SYSTEM` + 包提示 之后）；若提供 memory，则把 `createMemoryTool(deps.memory.remember)` 合并进默认工具集。
- 离线/本地模型路径同样注入记忆 + 带 remember 工具（机器事实离线也有用）。

### 阶段映射 `stream-agent.ts`

`phaseForTool('remember')` → `'thinking'`（记笔记是附带动作，不显示"修复"）。

### 可见/管理

- 设置弹窗加"记忆"一行 + 按钮"打开记忆文件" → IPC `memory:open` → `shell.openPath(memoryPath())` 用默认编辑器打开。preload 暴露 `openMemoryFile()`。

## 错误处理

- 读文件失败/损坏 → 当作空串，运行照常。
- 写文件失败 → 静默吞掉。记忆是增强项，**绝不能因记不上而影响主流程**。
- `remember` 拿到非法 category → 归到 `machine` 或拒绝（实现取前者，避免丢内容）。

## 涉及文件

**core（`packages/core`）**
- 新增 `src/memory/memory.ts`：类型 `MemoryCategory`/`MemoryEntry`、`looksSensitive`、`composeMemoryInjection(content): string`。
- 新增 `src/tools/memory-tool.ts`：`createMemoryTool(remember)` → `{ remember }`。
- 改 `src/run-shared.ts`：`RunDeps.memory`、注入、加工具。
- 改 `src/stream-agent.ts`：`phaseForTool` 处理 `remember`。
- 改 `src/index.ts`：导出新类型/函数。

**desktop（`apps/desktop`）**
- 新增 `src/main/memory.ts`：`memoryPath()`、`readMemory()`、`appendMemory(entry)`、`ensureScaffold()`。
- 改 `src/main/index.ts`：`agent:run` 传 `memory`；加 `memory:open` IPC。
- 改 `src/preload/index.ts`(+`.d.ts`)：暴露 `openMemoryFile()`。
- 改 `src/renderer/src/App.tsx`：设置里"打开记忆文件"按钮。
- 改 `src/renderer/src/lib/toolLabels.ts`：`remember` → "记住"（risk read）。

## 测试

**core**
- `composeMemoryInjection`：空内容 → `''`；非空 → 含"关于这台机器"标头 + 内容。
- `looksSensitive`：密钥/密码/路径 → true；普通事实 → false。
- `remember` 工具：普通 note → 调回调一次、返回"已记住"；敏感 note → 不调回调、返回隐私提示。
- `assembleRun`：传 memory 时 system 含注入文案、工具集含 `remember`；不传时无。

**desktop**
- `appendMemory`（tmp 文件）：缺文件 → 建脚手架并写到对应分节；重复行 → 跳过；不同 category → 落到不同分节；敏感 note → 不写。

## 非目标（YAGNI）

- 不做向量库/语义检索/对话历史长期存档。
- 不做"跑完抽取"的额外模型调用（选了方案 A）。
- 不做记忆管理面板（只给可编辑文件 + 打开按钮）。
- 不做自动过期/容量裁剪（v1 靠手动编辑）。
- 不做"事实上云、偏好仅本地"的分级（隐私边界统一为：只存非敏感）。
