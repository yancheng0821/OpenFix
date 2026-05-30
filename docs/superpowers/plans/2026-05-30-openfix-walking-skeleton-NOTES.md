# Walking Skeleton 执行记录与偏差

执行日期：2026-05-30 · 环境：macOS / Node v24.14 / pnpm 10.32.1

## 验证结果

- **core 单测**：7 passed（shell / network / llm / run-agent）
- **desktop 单测**：1 passed（App RTL）
- **typecheck**：core + desktop(node+web) 全过
- **electron-vite build**：main / preload / renderer 全部打包成功
- **无头端到端 smoke**（真 mimo 模型 + 真 ping）：
  - 模型 `mimo-v2-pro` 自主调用 `check_connectivity(8.8.8.8)`
  - 真实 `ping` 成功返回延迟，模型大白话回答"…是通的，延迟约 52 毫秒"
- **macOS 权限观察**：普通 node 进程直接 `execFile('ping', …)` **无需任何权限/sudo**。Electron main `sandbox:false` 同为 node 运行时，预期一致可用。
- **待人工确认**：GUI 窗口的可视化展示（renderer→IPC→main 已 typecheck + RTL + 打包验证，风险很低，仅差肉眼确认）。

## 与计划的偏差（实现时的修正，计划复用时请采纳）

1. **packageManager** 钉为本机 `pnpm@10.32.1`（计划写的 9.12.0 会触发 corepack 拉取）。
2. **core 加 `msw` devDep**：`ai/test` 经 `@ai-sdk/provider-utils` 间接 import `msw`，不装则测试加载即报错。
3. **run-agent 聚合工具调用**：`result.toolCalls` 只含最后一步；改用 `result.steps.flatMap(s => s.toolCalls)` 才能拿到调查阶段的调用（被 run-agent 测试抓到）。
4. **core 改 NodeNext + 相对 import 补 `.js`**：保持 ESM（兼容 ESM-only 的 `ai`），但 Node 原生 ESM 加载 externalize 的 core 时强制要求扩展名，否则 Electron 运行时 `ERR_MODULE_NOT_FOUND`。被无头 smoke 抓到——tsc/vitest/esbuild 都不要求扩展名，故只有真 Node ESM 加载才暴露。
5. **desktop 用 `vitest@^3`**（非计划的 ^2.1）：脚手架带 vite 7，vitest 3 才兼容。
6. **`tsconfig.web.json` 排除 `**/*.test.tsx`**：避免测试断言进入 app 类型检查。
7. **根 `pnpm.onlyBuiltDependencies: [electron, esbuild, electron-builder]`**：pnpm 10 默认拦构建脚本，不放行则 Electron 二进制不下载、`dev` 起不来。
8. **脚手架交互**：`--template react-ts` 定框架；updater=No，download mirror proxy=Yes（npmmirror，国内下 Electron 快）。`prompts` 库管道喂答案不可靠，此步由人工交互完成。
