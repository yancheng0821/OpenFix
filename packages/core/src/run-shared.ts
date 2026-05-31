import { generateText, type LanguageModel, type ToolSet, type ModelMessage } from 'ai'
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
import { createDiagnosticTools } from './tools/diagnostic.js'
import { createProposeFixTool } from './tools/propose-fix.js'
import { createMemoryTool } from './tools/memory-tool.js'
import { composeMemoryInjection, type MemoryEntry } from './memory/memory.js'

export const BASE_SYSTEM = `你是 OpenFix，帮用户搞定电脑和网络问题的助手。
说话像个靠谱的朋友：平实、好懂、温和友好，把复杂的事讲简单。不要居高临下，不要给用户贴"普通人/小白"之类的标签，也别用术语轰炸（需要用到术语时顺手一句话解释）。
用 run_diagnostic 跑**少量**关键的只读命令查清问题（通常 2~5 条就够，不要无止境地一直跑）；查清后**立刻**用简短的大白话给出结论和下一步建议。
确有必要时再用专门的"可逆/确认"修复工具——会自动记录、可一键还原。
若没有专门的修复工具能解决，可用 propose_fix 提出一条修复命令（会弹窗让用户确认，并必须同时给出撤销命令）。
当用户透露**长期有用**的偏好或事实（怎么称呼他、惯用设置、常用软件、这台机器的情况），或明确让你"记住"某事时，**必须调用 remember 工具**把它记下来——别只嘴上说"记住了"却没真记。
不要执行没把握的或不可逆的破坏性操作。`

export interface AgentResult {
  text: string
  toolCalls: Array<{ toolName: string; input: unknown }>
  changes: ChangeSummary[]
  rolledBack: boolean
  /** 本轮结束后的完整对话轨迹（含工具调用/结果），回灌下一轮即多轮上下文。 */
  messages: ModelMessage[]
}

export type AgentPhase = 'thinking' | 'investigating' | 'working' | 'fixing' | 'verifying'

export type AgentEvent =
  | { type: 'phase'; phase: AgentPhase }
  | { type: 'step'; id: string; tool: string }
  | { type: 'step-done'; id: string; output: unknown }
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
  /** 本地记忆：注入内容 + 写回调（由宿主进程提供文件 I/O）。 */
  memory?: { content: string; remember: (entry: MemoryEntry) => Promise<void> }
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
  return { model, tools, system, changeLog, verification }
}

/** 收尾安全策略：有可逆改动但复测未过 → 回滚可逆项 + 追加还原文案。 */
export async function finalizeRun(
  changeLog: ChangeLog,
  verification: Verification,
  baseText: string
): Promise<{ text: string; changes: ChangeSummary[]; rolledBack: boolean }> {
  // 只有"自动应用且需复测"的修复才受安全网约束；用户确认的 propose_fix 保留（手动还原）
  let rolledBack = false
  if (verification.passed !== true) {
    rolledBack = await changeLog.rollbackAutoRevert()
  }
  const changes = changeLog.list() // 还留着的改动（供"一键还原"面板）
  let text = baseText
  if (rolledBack) {
    text = `${text}\n\n（这次修复没通过复测，我已自动还原相关改动，系统恢复原样。）`.trim()
  }
  return { text, changes, rolledBack }
}

/**
 * 兜底收口：若主循环跑完没有产出文字结论（常因模型一直在跑命令、用尽步数），
 * 基于排查上下文再让模型补一段大白话结论（不带工具，保证一定有结论）。
 */
export async function concludeIfNeeded(
  model: LanguageModel,
  system: string,
  priorMessages: ModelMessage[],
  text: string
): Promise<string> {
  if (text.trim()) return text
  const res = await generateText({
    model,
    system,
    messages: [
      ...priorMessages,
      {
        role: 'user',
        content: '基于上面的排查结果，用简短的大白话给出结论和下一步建议；不要再调用任何工具。'
      }
    ]
  })
  return res.text
}
