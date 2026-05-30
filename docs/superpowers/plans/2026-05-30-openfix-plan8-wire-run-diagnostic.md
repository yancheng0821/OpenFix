# OpenFix Plan 8：接线 run_diagnostic + 退役手写读工具（A 方案落地）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Plan 6 建好的通用只读 `run_diagnostic`（白名单门控）接进引擎、退役手写读工具，落地"诊断=模型自由跑只读命令、修复=策划工具"的 A 方案。

**Architecture:** `run_diagnostic` 升为**通用工具**，在 `assembleRun`（run-shared）统一加入（人人可用，不属任何域）；技能包 `createTools` 只保留**写工具 + 复测工具**，`systemPrompt` 指引模型用 run_diagnostic 跑哪些域内只读命令。删除 `tools/network.ts`、`tools/network-diagnostics.ts`、`tools/system.ts` 及其测试（功能被 run_diagnostic 覆盖）。渲染层 `formatDetail` 已支持 run_diagnostic（显示其 `command`），无需大改。

**Tech Stack:** TypeScript · Vitest。

> **范围：** 仅 core（+少量测试改）。退役工具：check_connectivity / resolve_dns / check_proxy / get_wifi_info / check_disk_space / check_app_installed（命令分别被 run_diagnostic 的白名单 ping/dig/networksetup -get*/df/ls 覆盖）。保留：set_dns_servers、empty_trash、verify_connectivity。

---

## Task 1: run_diagnostic 进 assembleRun（通用读工具）

**Files:** Modify `packages/core/src/run-shared.ts`、`run-shared.test.ts`

- [ ] 顶部加 `import { createDiagnosticTools } from './tools/diagnostic.js'`
- [ ] `BASE_SYSTEM` 改为引导用 run_diagnostic（见实现）
- [ ] `assembleRun` 的 tools 改为 `deps.tools ?? { ...createDiagnosticTools(shell), ...composeTools(packs, skillContext) }`
- [ ] `run-shared.test.ts` 的"默认装配"用例加断言 `expect(Object.keys(a.tools)).toContain('run_diagnostic')`
- [ ] Run: `pnpm --filter @openfix/core test src/run-shared.test.ts` → PASS
- [ ] commit `feat(core): run_diagnostic 升为通用读工具进 assembleRun`

`BASE_SYSTEM`：
```ts
const BASE_SYSTEM = `你是 OpenFix，帮普通人排查并修复电脑问题的助手。
用 run_diagnostic 跑只读命令来排查（它只允许安全的只读命令）；确有必要时再用专门的"可逆/确认"修复工具——会自动记录、可一键还原。
不要执行没把握的或不可逆的破坏性操作。最后用简短的大白话告诉用户你查到/改了什么。`
```

## Task 2: 技能包退役读工具 + 更新 systemPrompt

**Files:** Modify `skills/network-pack.ts`、`network-pack.test.ts`、`skills/system-pack.ts`、`system-pack.test.ts`

- [ ] `network-pack.ts`：删掉 `createNetworkTools`/`createNetworkDiagnosticTools` 的 import 与展开；`createTools` 只留 `{ ...createNetworkFixTools(...), ...createNetworkVerifyTools(...) }`；`systemPrompt` 指引命令
- [ ] `system-pack.ts`：删掉 `createSystemTools` 的 import 与展开；`createTools` 只留 `{ ...createSystemFixTools(...) }`；`systemPrompt` 指引命令
- [ ] `network-pack.test.ts` 工具清单断言 → `['set_dns_servers','verify_connectivity']`
- [ ] `system-pack.test.ts` 工具清单断言 → `['empty_trash']`
- [ ] Run skills 测试 → PASS
- [ ] commit `refactor(core): 技能包退役手写读工具，改由 run_diagnostic 覆盖`

network-pack `systemPrompt`：
```
【网络域】用 run_diagnostic 跑只读命令排查：ping <主机>、dig +short <域名>、scutil --dns、networksetup -getdnsservers Wi-Fi、networksetup -getwebproxy Wi-Fi、networksetup -getairportnetwork en0。可逆修复：set_dns_servers（改 DNS）。任何修复后必须调用 verify_connectivity 复测，只有复测通过才算修好。
```
system-pack `systemPrompt`：
```
【软件/系统域】用 run_diagnostic 跑只读命令排查：df -h /（磁盘占用）、ls /Applications（软件是否安装）、ps aux（进程）、vm_stat（内存）。不可逆修复（需确认）：empty_trash（清空废纸篓）。
```

## Task 3: 删除退役文件 + 修受影响的 run-agent 测试

**Files:** Delete `tools/network.ts(.test)`、`tools/network-diagnostics.ts(.test)`、`tools/system.ts(.test)`；Modify `run-agent.test.ts`

- [ ] `run-agent.test.ts` 的"默认包含软件/系统包"用例：把模型改成调用 `run_diagnostic {command:'df',args:['-h','/']}`，断言 `calls` 含 `df`（验证 run_diagnostic 在默认工具里）
- [ ] 删除 6 个退役文件
- [ ] Run: `pnpm --filter @openfix/core test && typecheck && build` → 全 PASS
- [ ] 验证 desktop：`typecheck && test`（formatDetail 已支持 run_diagnostic）
- [ ] commit `refactor(core): 删除退役读工具文件，run-agent 测试改用 run_diagnostic`

## Self-Review
- A 方案落地：诊断=run_diagnostic（白名单只读）、修复=策划工具 ✅
- 退役工具的命令均在白名单内（ping/dig/networksetup -get*/df/ls）✅
- 渲染层 formatDetail 已支持 run_diagnostic（显示 command），timeline 不丢信息 ✅
