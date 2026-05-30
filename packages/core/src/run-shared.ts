import { type LanguageModel, type ToolSet } from 'ai'
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

export const BASE_SYSTEM = `你是 OpenFix，帮普通人排查并修复电脑问题的助手。
先用只读工具查清情况；确有必要时可调用"可逆"修复工具——会自动记录、可一键还原。
不要执行没把握的或不可逆的破坏性操作。最后用简短的大白话告诉用户你查到/改了什么。`

export interface AgentResult {
  text: string
  toolCalls: Array<{ toolName: string; input: unknown }>
  changes: ChangeSummary[]
  rolledBack: boolean
}

export type AgentEvent =
  | { type: 'phase'; phase: 'investigating' | 'fixing' | 'verifying' }
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
  const tools = deps.tools ?? composeTools(packs, skillContext)
  const system = deps.tools
    ? BASE_SYSTEM
    : [BASE_SYSTEM, composeSystemPrompts(packs)].filter(Boolean).join('\n\n')
  return { model, tools, system, changeLog, verification }
}

/** 收尾安全策略：有可逆改动但复测未过 → 回滚可逆项 + 追加还原文案。 */
export async function finalizeRun(
  changeLog: ChangeLog,
  verification: Verification,
  baseText: string
): Promise<{ text: string; changes: ChangeSummary[]; rolledBack: boolean }> {
  const applied = changeLog.list()
  const reversibleApplied = applied.filter((c) => c.riskLevel === 'reversible')
  let rolledBack = false
  if (reversibleApplied.length > 0 && verification.passed !== true) {
    await changeLog.rollbackReversible()
    rolledBack = true
  }
  let text = baseText
  if (rolledBack) {
    text = `${text}\n\n（修复没有通过复测，我已把改动全部还原，系统恢复原样。）`.trim()
  }
  return { text, changes: applied, rolledBack }
}
