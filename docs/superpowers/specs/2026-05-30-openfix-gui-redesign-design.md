# OpenFix GUI 重设计 + 真·流式交互 设计稿

- **日期**：2026-05-30
- **状态**：设计已通过，待用户复审 → 进入实现计划
- **一句话**：把现有"会用但通用"的聊天界面，重做成 macOS 原生质感（浅+深自动跟随）的桌面壳，并把当前"阻塞式一次性返回"的 agent 调用升级为**真·流式**——排查的每一步、结论的每个字都实时呈现。

---

## 1. 背景：现状与问题

现有渲染层（`apps/desktop/src/renderer/src/App.tsx` + `App.css`）：

- 普通气泡聊天 + 文字 header "OpenFix"，视觉通用、不像一款打磨过的 macOS 工具。
- **数据流是阻塞式的**：渲染层 `window.api.runAgent(history)` → `ipcMain.handle('agent:run')` → `runAgent()` → AI SDK `generateText`（`stepCountIs(8)`），**整个 8 步 loop 跑完才返回**。`runAgent` 内部有 `result.steps`（调查阶段的工具调用），但**从不实时暴露**，界面运行期间只显示一个静态 "排查中…"。

这与设计稿（`2026-05-30-openfix-design.md`）原则 4"事后透明——想看的人能看，不想看的人无视"以及"最多一行字滚动"的体验承诺不匹配。本次重设计补齐这块。

## 2. 目标 / 非目标

### 目标
- macOS 原生浅色视觉，**浅+深自动跟随系统外观**。
- **真·流式（SSE 式）交互**：工具步骤、文字结论实时推送到界面。
- 进度呈现采用"克制 + 可展开"模式（下称 **C 方案**）。
- 组件化重写渲染层，提供新 logo 的 GPT image 提示词。

### 非目标
- 不改 agent 的排查/修复**能力**（工具、安全、回滚逻辑不变）。
- 不动现有 `runAgent` 的签名与返回（保护既有测试），新增并行的流式入口。
- 不引入重型 UI 框架/组件库（保持依赖精简）。
- 不做 Windows、不做本地模型——延续主设计稿范围。

## 3. 已定决策（来自 brainstorming）

| # | 决策 | 选择 |
|---|---|---|
| 1 | 进度/流式呈现 | **C — 克制 pill + 逐字流式结论 + 可展开时间线** |
| 2 | 视觉风格 | **A — macOS 原生（系统蓝 #0A84FF + SF 字体 + 毛玻璃感）** |
| 3 | 外观模式 | **浅 + 深，自动跟随系统**（`prefers-color-scheme`） |
| 4 | 后端范围 | **真流式：改 `packages/core` + IPC**（不做"假流式"） |
| 5 | Logo 概念 | **修复隐喻符号（扳手 + 对勾 + 信号脉冲弧）+ 系统蓝 squircle** |

## 4. 架构

### 4.1 Core：新增 `streamAgent()`，保留 `runAgent()`
- 现有 `runAgent`（`generateText`）**原样保留** → 既有 core 测试零风险、程序化调用不变。
- 新增 `streamAgent(input, deps & { onEvent })`：内部用 AI SDK 的 `streamText` + 消费 `fullStream`，把工具步骤与文字增量通过 `onEvent` 实时回调。
- 把两者共用的部分抽成 helper（保持单一职责、可独立测）：
  - 工具装配（`createNetworkTools` / `createNetworkFixTools` / `createNetworkVerifyTools`）
  - `SYSTEM_PROMPT`
  - 收尾安全策略：有改动但 `verification.passed !== true` → `changeLog.rollbackAll()` + `rolledBack=true` + 追加还原说明文案
- `streamAgent` 在 `fullStream` 结束后，复用同一收尾逻辑，最终 `onEvent({type:'done', result})` 并 `return result`（结构与 `AgentResult` 一致）。

### 4.2 事件协议（"SSE 的内容"）
core 只产出**结构化数据**，不掺表现层文案以外的东西；图标/风险色由渲染层映射。
```ts
export type AgentEvent =
  | { type: 'phase';  phase: 'investigating' | 'fixing' | 'verifying' }
  | { type: 'step';   tool: string; title: string; detail?: string; risk: 'read' | 'write' | 'verify' }
  | { type: 'text';   delta: string }                 // 结论逐字增量
  | { type: 'change'; change: ChangeSummary }          // 一条可还原改动
  | { type: 'verify'; passed: boolean }
  | { type: 'done';   result: AgentResult }
  | { type: 'error';  message: string }
```
- AI SDK `fullStream` → `AgentEvent` 的映射在 `streamAgent` 内完成：
  - `tool-call` → `step`（`tool` = toolName；`risk` 按工具名归类：只读网络工具=`read`、`*-fix`=`write`、`verify_*`=`verify`；`title`/`detail` 给一个简洁默认值，最终人类可读标题由渲染层 `toolLabels` 兜底美化）。
  - `tool-result` → 可选地补全对应 `step` 的 `detail`（如 "DNS=192.168.1.1"）。
  - `text-delta` → `text`。
  - 写工具命中 → 顺带 `phase:'fixing'`；verify 工具命中 → `phase:'verifying'`；起始 `phase:'investigating'`。
- `risk` 判定**不交给 LLM**，由工具来源/命名规则决定（延续主设计稿"不可逆判定不裸信 LLM"的命门原则）。

### 4.3 IPC（`main` + `preload`）
- `main/index.ts`：`agent:run` handler 内调用 `streamAgent(messages, { changeLog, onEvent: (ev) => event.sender.send('agent:event', ev) })`；结束后仍 `return result`，保留现有"成功且有改动则留 `currentRollback` 句柄"的逻辑。`agent:rollback` 不变。
- 单窗口、同一时刻仅一次运行 → 用单一 `agent:event` 频道即可，不引入 runId。
- `preload/index.ts`：`runAgent(history, onEvent?)` —— `invoke('agent:run', history)` 的同时 `ipcRenderer.on('agent:event', …)` 转发给 `onEvent`，Promise settle 后 `removeListener` 退订（防泄漏）。`rollback()` 不变。`index.d.ts` 同步类型。

### 4.4 渲染层（重写，组件化）
```
apps/desktop/src/renderer/src/
  theme.css                 设计 token（浅+深，prefers-color-scheme）
  hooks/useAgentRun.ts      流式状态机：phase / steps[] / streamingText / changes[] / status
  lib/toolLabels.ts         工具名 → { icon, title, risk } 的表现层映射
  components/
    TitleBar.module.css/.tsx       hiddenInset 标题栏：居中 logo mark + "OpenFix"
    Conversation.tsx               消息列表（自动滚到底）
    EmptyState.tsx                 空态：引导语 + 示例 chips（"我连不上网"/"GitHub 打不开"/"电脑好卡"）
    MessageBubble.tsx              用户(右,蓝)/助手(左,灰)气泡
    RunActivity.tsx                C 方案：pill(钉住的当前步) + 可展开时间线(时间戳·✓完成·风险色图标·mono技术值·可还原chip) + 逐字流式结论(caret)
    ChangesPanel.tsx               "我改了这些（可还原）" + 一键还原 + 已还原态
    EmptyState.tsx                 logo + 安抚文案 + 可点击示例 chips（点击预填入输入框）
    Composer.tsx                   浮起 field + 内嵌圆形 ↑ 发送图标 + 键盘提示（回车发送 / Shift+Enter 换行）
  App.tsx                    组装 + useAgentRun 接线
```
- 样式用 **CSS Modules**（`*.module.css`，electron-vite 零配置支持）+ `theme.css` 全局 token；移除旧 `App.css` 的承载方式。
- 技术值/时间戳用**等宽字体**（`ui-monospace, 'SF Mono'`），把"叙述文案"与"技术事实"（`en0`、`192.168.1.1`、`SERVFAIL`、端口、时间戳）分层呈现（Raycast 手法，强化"深挖"可信度）。
- `main/index.ts` 的 `BrowserWindow`：`titleBarStyle: 'hiddenInset'`（红绿灯左对齐、logo 居中）+ macOS `vibrancy`（如 `'sidebar'`/`'under-window'`）+ `transparent`/`backgroundColor` 配合，做出原生半透明质感；内容为左上红绿灯留安全区。

### 4.5 数据流（重写后）
```
用户回车
 → useAgentRun: setStatus('running'); window.api.runAgent(history, onEvent)
 → main: streamAgent(..., onEvent → send 'agent:event')
 → 渲染层按事件实时更新：
     phase  → pill 文案/相位
     step   → 追加时间线一行（toolLabels 美化 icon+title），更新 pill 最新行
     text   → 追加流式结论字符（caret 闪烁）
     change → 暂存改动
     verify → 标记复测结果
     done   → 落地 assistant 消息 + 收起活动；有改动且未回滚 → 显示 ChangesPanel
     error  → 错误气泡
```

## 5. 视觉设计 token

**表面阶梯（不用重边框，靠 elevated + 发丝描边 + 柔和多层阴影区分层级，Raycast 手法）：**

| token | 浅色 | 深色 |
|---|---|---|
| canvas（窗口底） | `#f4f5f7` | `#161617` |
| surface / elevated 卡片 | `#ffffff` | `#1f1f21` |
| 标题栏（半透明 blur） | `rgba(250,250,252,.7)` | `rgba(38,38,40,.66)` |
| 主文字 / 次要 / 三级 | `#1d1d1f` / `#6b6b70` / `#8e8e93` | `#f5f5f7` / `#9b9ba0` / `#76767c` |
| 强调（accent） | `#0a84ff` | `#2a92ff` |
| 用户气泡 | `#0a84ff` / 白字 | `#0a84ff` / 白字 |
| 助手气泡 | `#ffffff` + 发丝描边 | `#2a2a2d` |
| pill 文字 | `#0a6fdc` | `#6fb0ff` |
| chip（可还原） | `#eaf3ff` / 字 `#0a6fdc` / 边 `#d3e6ff` | `#13233e` / 字 `#6fb0ff` / 边 `#264268` |
| 改动面板 | `#ffffff` + 阴影 | `#1f1f21` + 阴影 |
| 发丝线 hairline | `rgba(0,0,0,.08)` | `rgba(255,255,255,.09)` |
| 卡片阴影 | `0 1px 2px rgba(16,24,40,.05), 0 8px 22px rgba(16,24,40,.06)` | `0 1px 2px rgba(0,0,0,.4), 0 10px 26px rgba(0,0,0,.45)` |
| 风险色：read / write / verify / done | `#0a84ff` / `#ff9f0a` / `#34c759` / `#34c759`（浅深通用） | 同左 |

- **字体**：UI = `-apple-system, 'SF Pro Text', 'PingFang SC', system-ui, sans-serif`；技术值/时间戳 = `ui-monospace, 'SF Mono', 'JetBrains Mono', monospace`。
- **字号梯度**：标题 18/600（紧排 -.01em）· 正文 13/400 · 次要 12 · 元信息 11（含 mono 时间戳）。
- **圆角梯度**：气泡 16 · 卡片/面板 13–14 · 按钮/输入 9–11 · pill/chip 999。8px 栅格，区块间距 14–24。
- **动效**：pill 圆点呼吸脉冲；流式结论闪烁光标 `▍`；时间线行渐入。遵循 `prefers-reduced-motion`。

## 6. C 方案进度行为（细化）
- **默认克制态**：一行 pill = **钉住的"当前步"指示**（呼吸点 + "正在排查 · <当前动作>"）+ 一句逐字流式结论。右侧"查看详情 ▾"。
- **展开态**：在 pill 下方显示完整时间线，每行 = `mono 时间戳 · 状态图标 · 标题 + mono 技术值`；已完成步打 `✓`、当前步显 `⏳`/呼吸；写操作行挂"**已快照·可还原**" chip。"收起详情 ▴"。
- 展开/收起为用户偏好，运行中也可切换，不影响流式。
- 运行结束：活动卡片可整体收起为一条"已完成"摘要（结论文字落入 assistant 气泡），随后渲染 ChangesPanel。
- **空态**：居中 logo + 安抚标题（"电脑哪儿不舒服？"）+ 一句话说明 + 可点击示例 chips（我连不上网 / GitHub 打不开 / 网速很慢 / 电脑好卡），点击预填入输入框。

## 7. Logo
已收到成品（见 `2026-05-30` 提供的图）：**白色 squircle + 系统蓝渐变字形**——扳手与向下箭头合体（寓意"修复/接通"），两侧对称信号弧（寓意网络恢复），玻璃质感、柔和顶光。完全符合 brief。
- 落地：放入 `apps/desktop/resources/icon.png`（main 已 `import icon`）；打包多尺寸图标在 `apps/desktop/build/` 生成（`.icns`/各尺寸 PNG）。
- 应用内标题栏 / 空态 mark 用同款图（小尺寸，圆角 5–16）。
- 原始大图源（用户桌面）在实现阶段第一步拷入仓库以防丢失。

> 备查：当初的 GPT image 提示词为 `macOS app icon … fuses a wrench with a checkmark, subtle signal-pulse arc … Apple system blue (#0A84FF) gradient … squircle, no text, 1024×1024`。

## 8. 风险 / 实现注意
- **`streamText` 与测试 mock**：`streamText` 需要模型实现 `doStream`（而非 `generateText` 的 `doGenerate`）。`streamAgent` 的单测要用支持 `doStream` 的 MockLanguageModel；`runAgent` 既有测试不受影响（保持 `generateText`）。
- **事件顺序与最终一致性**：以 `done` 携带的 `AgentResult` 为权威；流式途中累积的 `changes`/文字仅用于呈现，`done` 时对齐校正。
- **IPC 监听泄漏**：`preload` 必须在 settle 后 `removeListener`，避免多次运行叠加监听。
- **`titleBarStyle:'hiddenInset'`**：内容需为左上红绿灯留出安全区（标题栏 padding-left），避免被遮挡。
- **回滚句柄**：流式不改变 main 持有 `currentRollback` 的契约（成功且有改动才留句柄）。

## 9. 测试策略
- **core `streamAgent`**：用 `doStream` mock 模型 + mock shell + 注入 `ChangeLog`，断言 (a) 事件序列含 step/text/change/verify/done；(b) 复测未过时 `done.result.rolledBack===true` 且发生回滚；(c) 与 `runAgent` 在同输入下最终 `AgentResult` 等价。
- **共用 helper**：抽出后各自单测（工具装配、收尾安全）。
- **渲染层**：`useAgentRun` 状态机用伪 `onEvent` 流驱动做单测（不依赖真 IPC）；关键组件（RunActivity 展开/收起、ChangesPanel 还原态）做组件测试（延续现有 `App.test.tsx` 的 vitest 体系）。
- **IPC/preload**：轻量验证订阅—转发—退订。

## 10. 里程碑映射
- 属于主设计稿 **M1（v1）** 的 "GUI 壳" 打磨项，不扩大 M1 范围；只把已存在的壳做扎实并补齐流式透明度。

## 11. 生产级参考与采纳的模式
设计经 Mobbin + 真实生产级 app 研究后定型，以下模式被采纳（非凭空设计）：

- **Raycast（最 macOS-native 的 AI 工具）** → 表面阶梯(canvas→surface→elevated)、柔和多层阴影代替重边框、圆角梯度 `8/11/16`、克制用色(单一 accent)、UI 用 SF + 小号元信息用 mono 的"两register"排版。
- **2026 agent-UX 模式（Cursor / Perplexity / Notion AI / Chainlit / AG-UI）** → 可折叠活动时间线、**时间戳**、**钉住的当前步**指示、内联工具步骤卡、流式闪烁光标、写操作就近"可还原"入口；以及**类型化事件流（AG-UI）**——直接印证本稿 §4.2 的 `AgentEvent` 架构。
- **空态引导（ChatGPT / Raycast onboarding）** → logo + 一句话 + 可点击示例 prompt chips。

参考来源：
- Raycast 设计分析 https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/raycast/DESIGN.md ；技术深潜 https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast
- Designing for AI Agents: 10 UX Patterns (2026) https://mantlr.com/blog/designing-for-ai-agents-ux-patterns-2026 ；Agent UX Patterns https://hatchworks.com/blog/ai-agents/agent-ux-patterns/
- Mobbin web chatbot 合集 https://mobbin.com/explore/web/screens/chat-bot
