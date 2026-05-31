# OpenFix 架构与设计总览

> 给想搞清楚"它到底怎么实现的"的人。从大白话到代码，一层层讲。

## 0. 一句话

OpenFix = **一个会自己跑命令深挖问题、但只读受白名单管控、写操作分级可回滚的本地 AI agent**，外面套一个对话式 macOS 外壳给普通人用。

核心就两句话：
- **诊断（读）**：像 Claude Code 那样让模型自由跑命令，但**只读 + 白名单守门**。
- **修复（写）**：**分级**——能自动验证回滚的自动做，长尾的弹窗确认，危险的硬拦。

---

## 1. 整体架构：一个 monorepo，三层

```
┌─────────────────────────── apps/desktop (Electron) ───────────────────────────┐
│                                                                                 │
│   renderer (React UI)  ──IPC──►  main (Node 主进程)  ──调用──►  packages/core   │
│   对话界面/流式/面板              窗口·菜单·配置·记忆文件·                引擎(纯逻辑)│
│        ▲                          模型选择·离线回退                       ▲       │
│        └──────IPC 事件流(agent:event)─────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **`packages/core`**：与平台无关的**引擎**（不依赖 Electron）。它是"大脑"——agent loop、工具、安全、记忆全在这。可单测、可被任何宿主调用。
- **`apps/desktop/src/main`**：Electron 主进程（Node 环境）。负责开窗、原生菜单、读写配置/记忆文件、选云端还是本地模型、把引擎的事件转发给界面。
- **`apps/desktop/src/preload`**：安全桥（`contextBridge`），把主进程能力以 `window.api` 暴露给界面，渲染层不能直接碰 Node。
- **`apps/desktop/src/renderer`**：React 对话界面。

为什么分这么清：**引擎(core)不知道自己跑在 Electron 里**，所以它好测、好移植（以后 Windows / CLI / 服务端都能复用）。文件 I/O、弹窗这些"宿主能力"通过 `deps`（依赖注入）传进去。

---

## 2. 一个请求是怎么跑完的（最重要，看懂这个就懂大半）

以"我连不上网"为例：

```
1. 用户回车
   └─ renderer: useAgentRun.send()
      · 显示用户气泡
      · input = [...上一轮完整轨迹, {role:'user', content:'我连不上网'}]
      · window.api.runAgent(input, onEvent)     ← onEvent 接收实时事件

2. preload ──IPC 'agent:run'──► main

3. main 准备"宿主能力"
   · loadConfig()  → 云端 baseURL/key/model
   · readMemory()  → 这台机器的画像(openfix-memory.md)
   · memory = { content, remember: appendMemory }   ← 写记忆的能力
   · confirm = (desc) => 弹窗等用户点确认            ← 确认的能力
   · send    = (ev)   => 转发给 renderer('agent:event')

4. main 调引擎
   streamAgent(input, { model: createModel(云端), memory, confirm, onEvent: send })

5. core: assembleRun() 组装这次运行
   · tools  = run_diagnostic + propose_fix + 网络包 + 系统包 + remember
   · system = BASE_SYSTEM + 各包提示 + 记忆注入(把机器画像塞进系统提示)

6. core: streamText 跑 agent loop（最多 16 步），模型自己决定：
   · 调 run_diagnostic("ping 8.8.8.8")      → 白名单检查 ping → 放行 → 执行
   · 调 run_diagnostic("dig +short google") → 看到 198.18.x.x → 模型自己认出"Clash 在劫持"
   · 给结论 / 或调 clear_proxy 修复 → 改前快照 → verify_connectivity 复测
   每一步都从 fullStream 流出"零件"，被翻译成 AgentEvent：
   phase(阶段) / step(开始调工具) / step-done(工具结果) / text(逐字结论) / change(写操作) / verify(复测)
        └─ send ──IPC 'agent:event'──► renderer: reduceEvent() 实时更新界面

7. core: finalizeRun() 收尾安全网
   · 有"自动应用的可逆改动"但复测没过 → 自动还原
   · 返回 { text, changes(保留下来的), rolledBack, messages(本轮完整轨迹) }

8. main 返回结果 → renderer
   · modelMessages = res.messages   ← 存起来，下一轮接着用（多轮上下文）
   · 落地 assistant 气泡(下方挂可折叠的"执行过程")
   · 有保留改动 → 显示"我改了这些·一键还原"面板
```

> **记住这张图**：宿主能力(读配置/读写文件/弹窗/选模型)在 **main**；真正的"想 + 做"在 **core**；它俩通过 `deps` 注入 + `AgentEvent` 事件流通信。

---

## 3. Agent 引擎核心（`packages/core`）

三个关键函数都在 `run-shared.ts`：

- **`assembleRun(deps)`**：把一次运行需要的东西装好——选模型、组工具集、拼系统提示、建"改动账本(ChangeLog)"和"复测记录(Verification)"。`runAgent`(阻塞版)和 `streamAgent`(流式版)共用它。
- **`finalizeRun(changeLog, verification, text)`**：收尾安全策略——失败自动还原。
- **`concludeIfNeeded(...)`**：兜底——模型光跑命令没给结论时，强制让它补一句大白话（保证一定有回复）。

两个入口：
- **`streamAgent`**（界面用）：`streamText` + 遍历 `fullStream`，把流里的零件翻译成 `AgentEvent` 事件推给界面。里面还有 `stripThink`(过滤推理模型的 `<think>`) 和 `phaseForTool`(把工具映射成"正在排查/操作/修复…"状态)。
- **`runAgent`**（测试/非流式用）：`generateText` 一次性返回。

**模型无关**：`llm.ts` 的 `createModel(cfg)` 用 `@ai-sdk/openai-compatible`，只要是 OpenAI 兼容端点都能接（云端、网关、本地 Ollama）。

---

## 4. 安全模型（这是产品的命门）

```
读 ── run_diagnostic ──► isReadOnlyAllowed(白名单)
      允许: ping/dig/df/ls/ps/networksetup -get*/brew list... (只读)
      拒绝: rm/sudo/sh/curl/env, 以及读 .ssh/.aws/密钥/凭证(隐私守卫)

写 ── 四个风险级别(safety/write-tool.ts + change-log.ts) ──
   safe          直接做、自恢复            重启访达、打开 App         不记账
   reversible    改前快照→做→复测→没过自动还原   改 DNS/关代理/重启 WiFi    autoRevert=true
   propose_fix   模型给命令+撤销→弹窗确认→做     装软件/改配置(长尾)        autoRevert=false(只手动还原)
   irreversible  必须确认                  清空废纸篓                记账但撤不回
```

支撑它的四块：
- **`readonly-allowlist.ts`**：`isReadOnlyAllowed(cmd,args)` —— 白名单制，未知一律拒；双用命令(networksetup/git/brew…)只放只读子命令；解释器只准查版本；敏感路径(密钥)即便读也拒。
- **`write-tool.ts`**：`createWriteTool(spec)` —— 把一个写操作按风险级别包成 AI SDK 工具。
- **`change-log.ts`**：`ChangeLog` —— 改动账本，记录每条改动 + 它的撤销函数；支持"全部回滚 / 只回滚可逆 / 只回滚自动型(安全网)"。**`autoRevert` 标记**区分"网络修复(该自动还原)"和"用户确认的 propose_fix(该保留、只手动还原)"——这是修过的一个真 bug：否则装的软件会被安全网误卸载。
- **`verification.ts`**：`Verification` —— 记一次"修复后复测"结果，`finalizeRun` 据此决定回不回滚。

---

## 5. 工具与技能包

**通用逃生口**（覆盖无限长尾，不用一个个手写）：
- `run_diagnostic`(读) + `propose_fix`(写) —— 任何没专门工具的场景，模型自己出命令。

**策划的高频工具**（要快照/复测/快的才手写）：
- 网络：`set_dns_servers` / `clear_proxy` / `restart_wifi` / `verify_connectivity`
- 系统：`empty_trash` / `kill_process` / `restart_finder` / `restart_dock` / `open_app` / `open_url`
- 记忆：`remember`

**技能包机制**（`skills/skill-pack.ts`）：`SkillPack = {name, createTools(ctx), systemPrompt}`。`composeTools/composeSystemPrompts` 把多个包合并。加一个新领域 = 写一个 pack 文件，引擎不用动。目前有 `networkSkillPack`、`systemSkillPack`。

---

## 6. 记忆系统（`memory/memory.ts` + `main/memory.ts`）

- **存哪**：`userData/openfix-memory.md`，人类可读可编辑的 markdown，三节：机器事实/偏好/过往修复。
- **怎么读**：每轮 `readMemory()` → `composeMemoryInjection()` 把内容塞进系统提示。
- **怎么写**：模型学到耐久事实 → 调 `remember` 工具 → `applyMemory()`(去重/敏感守卫) → `appendMemory()` 落盘。
- **隐私**：`looksSensitive()` 拦截密钥/密码/隐私路径，代码强制，不只靠提示词。
- 设计哲学：这是**通用机制**(agent 学这台机器的事实)，不是往提示词里塞死知识。跨会话靠它，会话内靠"轨迹串联"(见下)。

---

## 7. 多轮上下文（结构解决，不靠提示词）

每轮 `streamAgent` 返回 `AgentResult.messages` = **本轮结束后的完整对话轨迹（含工具调用 + 工具结果）**。渲染层用一个 `ref` 存着，下一轮 `[...上轮轨迹, 新user]` 回灌给模型。

所以模型每轮都**看得到上一轮查到的东西**（比如桌面路径、活动网卡），不会重查——**没有任何"请利用上文"的提示词**，纯靠把完整 transcript 串起来（和 Claude Code 一样）。

---

## 8. 流式与界面（`renderer`）

- **`useAgentRun.ts`**：状态机。`reduceEvent(state, event)` 把 `AgentEvent` 折叠进运行态(纯函数可单测)；`send`(发起+串轨迹)、`reset`(新对话)、`rollback`(一键还原)。
- **`useTypewriter.ts`**：打字机缓冲，把"已收到全文"按帧匀速吐字，和网络分块解耦 → 流式顺滑。
- **`App.tsx`**：对话界面——空态示例、实时进度(状态 pill + 步骤时间线)、流式 markdown、改动面板、确认弹窗、设置、新对话。完成后步骤折叠保留。
- **`toolLabels.ts`**：工具名→中文标签 + 技术值展示("更新记忆文件 · 活动网卡 en7=AX88179B")。

---

## 9. 配置 / 本地模型 / 隐私

- **配置**(`main/config.ts`)：`userData/openfix-config.json`，缺省读 `.env`(OPENFIX_LLM_*)。设置 ⌘, 可改。
- **本地模型**：**仅断网兜底**，且**不内置**——需自装 Ollama(`localhost:11434`)。云端失败(连不上)→ 自动切本地、只给网络包；本地也没有则友好告知。
- **隐私边界**：诊断输出 + 非敏感记忆随请求上模型；自带 key 直连则不经第三方；白名单挡敏感路径，记忆挡密钥。

---

## 10. 关键设计决策与"为什么"

| 决策 | 为什么 |
|---|---|
| **深 + 普通人能用 + 安全可回滚** | 护城河：Claude Code 够深但普通人用不了/无护栏；Marvis 够傻瓜但太浅。卡中间甜区。 |
| **读 = 通用白名单 shell**（A 转向） | 一次策划白名单 = 无限诊断广度，不用一个场景手写一个读工具。 |
| **写 = 策划 + 分级 + 快照/回滚** | 安全只在"写"这里非妥协；自动验证+失败还原比频繁弹窗更不打扰。 |
| **不打地鼠**（提示词只给原则，不背具体现象） | fake-ip 等知识模型本来就有；枚举永远背不完。结构能解的别塞提示词。 |
| **多轮 = 轨迹串联** | 模型看完整 transcript 自然复用，不靠"请利用上文"的提示词。 |
| **记忆 = 本地可编辑文件** | 通用机制学"这台机器"的事实；全自动写、可见可改、敏感守卫。 |
| **本地模型 = 离线兜底** | 断网才用，只修网络；不内置避免撑爆安装包。 |
| **模型无关(OpenAI 兼容)** | 普通人后续能换自己的模型/网关。 |

---

## 文件地图（速查）

```
packages/core/src/
  run-shared.ts        assembleRun / finalizeRun / concludeIfNeeded / BASE_SYSTEM / 类型
  run-agent.ts         runAgent(阻塞)
  stream-agent.ts      streamAgent(流式) / stripThink / phaseForTool
  llm.ts               createModel(OpenAI 兼容)
  safety/
    readonly-allowlist.ts  只读白名单
    write-tool.ts          风险分级写工具工厂
    change-log.ts          改动账本 + 回滚(含 autoRevert)
    verification.ts        复测记录
  tools/
    diagnostic.ts          run_diagnostic
    propose-fix.ts         propose_fix
    network-fix.ts         set_dns/clear_proxy/restart_wifi(+活动网卡解析)
    network-verify.ts      verify_connectivity(curl 真探测)
    system-fix.ts          清理/进程/访达/打开 App/URL
    memory-tool.ts         remember
  skills/
    skill-pack.ts          SkillPack 机制
    network-pack.ts / system-pack.ts
  memory/memory.ts     记忆文档逻辑(注入/写合并/敏感守卫)

apps/desktop/src/
  main/index.ts        窗口·原生菜单·IPC·云/本地模型·离线回退·dock 图标
  main/config.ts       配置读写
  main/memory.ts       记忆文件 I/O
  preload/index.ts     window.api 安全桥
  renderer/src/
    App.tsx            对话界面
    hooks/useAgentRun.ts   状态机 + 多轮轨迹
    hooks/useTypewriter.ts 打字机
    hooks/useConfirm.ts    确认弹窗
    lib/toolLabels.ts      工具标签
```
