<div align="center">

<img src="apps/desktop/build/icon.png" width="116" alt="OpenFix" />

# OpenFix

**一句话搞定电脑和网络问题的本地 AI 助手**
*A friendly, local AI assistant that fixes computer & network problems for everyday people.*

macOS · Electron + React + TypeScript · 模型无关（OpenAI 兼容）

</div>

---

## 这是什么

OpenFix 是一个跑在你电脑本地的 AI 助手：你用大白话说一句（"我连不上网""帮我装个 ffmpeg""电脑好卡"），它**自己排查、自己修、修完自己验证**，全程不打扰你。

它的定位在两个极端之间的甜区：

| | 深度 | 普通人能用 | 安全护栏 |
|---|:---:|:---:|:---:|
| 腾讯 Marvis 等"助手" | 浅 | ✅ | — |
| Claude Code / Codex | **深** | ❌（面向开发者） | ❌ |
| **OpenFix** | **深** | **✅** | **✅ 可回滚** |

像 Claude Code 一样**让模型自由跑诊断命令**深挖根因，但面向**不会用命令行的普通人**，并且把安全做成产品命门——**自动应用 + 自动验证 + 失败自动还原 + 一键回滚**，而不是频繁弹窗打扰。

> ⚠️ 项目开发阶段，能力与界面仍在快速迭代。

## 核心特性

- **🔍 深度诊断**：模型通过白名单门控的只读 shell（`run_diagnostic`）自由跑命令查清问题——一次策划白名单 = 几乎无限的排查广度，而非一个场景手写一个工具。
- **🛡️ 安全可回滚的修复**：
  - 可逆修复（改 DNS / 关代理 / 重启 Wi-Fi）**自动应用 + 改前快照**，复测没过**自动还原**；
  - 长尾修复走 `propose_fix`（模型给命令 + 撤销命令，**弹窗确认**后执行，可手动一键还原）；
  - 不可逆操作（清空废纸篓等）**必须确认**。
- **🌐 网络域**：作用于**当前活动网卡**（自动解析默认路由，不写死 Wi-Fi）；用真实 HTTP 请求复测"能不能上网"。
- **🧰 软件/系统域**：清理、结束卡死进程、重启访达/程序坞、打开 App/网址、用 Homebrew 装/更新软件、程序打不开排查等。
- **🧠 本地记忆**：自动记住这台机器的事实和你的偏好（`openfix-memory.md`，可手动编辑，只存非敏感信息），下次更快帮上忙。
- **💬 多轮对话**：串联完整对话轨迹（含工具结果），上一轮查清的不再重查。
- **⚡ 流式体验**：边想边答、打字机平滑输出、执行步骤完成后可折叠回看。
- **🔒 隐私优先**：白名单拒绝读取 `.ssh/.aws`/密钥/凭证等敏感路径；记忆不写密钥/账号。
- **📴 离线兜底（可选）**：断网时可自动回退到本地模型（需自装 [Ollama](https://ollama.com)），仅用于排查网络问题。

## 安全模型（项目的命门）

```
读：run_diagnostic —— 白名单门控的只读 shell（拒绝 rm/sudo/curl/敏感路径…）
写：分级处理
   ├─ safe         直接做、自恢复（重启访达/打开 App）
   ├─ reversible   改前快照 → 自动应用 → 复测 → 没过自动还原（网络修复）
   ├─ propose_fix  模型给命令+撤销 → 弹窗确认 → 执行 → 可手动一键还原
   └─ irreversible 必须确认（清空废纸篓…）
```

## 技术栈与架构

pnpm monorepo：

```
openfix/
├─ apps/desktop      Electron 桌面端（主进程 + preload + React 渲染层）
│  └─ src/
│     ├─ main/       窗口、IPC、原生菜单、配置、记忆文件、本地模型回退
│     ├─ preload/    contextBridge 暴露的安全 API
│     └─ renderer/   对话式 GUI（React + TS）
├─ packages/core     与平台无关的 agent 引擎
│  └─ src/
│     ├─ run-agent / stream-agent   薄 agent loop（Vercel AI SDK）
│     ├─ safety/     白名单、可逆写工具、改动账本、复测、回滚
│     ├─ tools/      run_diagnostic / propose_fix / 网络 / 系统 / 记忆
│     └─ skills/     可插拔技能包（network / system）
└─ docs/             设计 spec 与实现计划
```

- **引擎**：[Vercel AI SDK](https://sdk.vercel.ai)（`@ai-sdk/openai-compatible`，模型无关）+ 自写薄 agent loop。
- **技能包**：`SkillPack` 贡献工具 + 系统提示；加新域 = 写个 pack，引擎不动。
- 设计参考 [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code)（monorepo 分层、技能包），引擎自写。

## 快速开始

**前置**：macOS · Node ≥ 20 · pnpm 10

```bash
git clone https://github.com/yancheng0821/OpenFix.git
cd OpenFix
pnpm install
```

**配置模型**（OpenAI 兼容端点，二选一）：

1. 在 `apps/desktop/.env` 写入默认值（已 gitignore）：
   ```bash
   OPENFIX_LLM_BASE_URL=https://your-endpoint/v1
   OPENFIX_LLM_API_KEY=sk-...
   OPENFIX_LLM_MODEL=your-model
   ```
2. 或启动后在应用内 **设置（⌘,）** 里填 接口地址 / API Key / 模型。

> 任何提供 **OpenAI 兼容** `/v1/chat/completions` 端点的服务都可接入：OpenAI、各类网关（LiteLLM 等）、MiniMax/通义等的兼容端点、本地 Ollama。

**运行**：

```bash
pnpm dev
```

## 构建

```bash
pnpm --filter @openfix/desktop build:unpack   # 出未压缩 .app（最快，验证用）
pnpm --filter @openfix/desktop build:mac      # 出 dmg
```

## 开发

```bash
pnpm test         # 全部单测（vitest）
pnpm typecheck    # 类型检查
```

引擎逻辑（白名单、回滚、记忆、多轮等）都有单测覆盖；Electron/React 胶水靠类型检查 + 构建验证。

## 路线图

- [ ] 新 Logo 与 UI 打磨、深色模式
- [ ] 打包上架：签名 + 公证
- [ ] **托管 freemium**：内置网关 + 免费额度，让普通人零配置（自带 key 作高级项）
- [ ] 更多高频修复能力
- [ ] Windows 移植

## 隐私

- 诊断命令输出与（非敏感）记忆会随请求发送给你配置的模型服务；用自己的 key 直连时不经任何第三方服务器。
- 只读白名单**拒绝**读取 `.ssh` / `.aws` / `id_rsa` / `.pem` / 凭证 / 钥匙串等敏感路径；记忆守卫拒绝写入密钥/密码。

## License

待定（建议 MIT）。

---

<div align="center">
用 ❤️ 打造，让不懂电脑的人也能把电脑用明白。
</div>
