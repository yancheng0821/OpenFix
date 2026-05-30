import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai'
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

export interface RunAgentDeps {
  model?: LanguageModel
  tools?: ToolSet
  /** 注入 shell（测试用 mock，避免真实系统改动）；不传则用 runReadOnly。 */
  shell?: ShellRunner
  /** 注入 ChangeLog（main 进程持有，供运行结束后用户"一键还原"）；不传则内部新建。 */
  changeLog?: ChangeLog
  /** 注入技能包（每包贡献工具+系统提示）；不传则用默认 [networkSkillPack]。 */
  skillPacks?: SkillPack[]
  /** 不可逆操作的确认回调；不传则不可逆工具一律拒绝。 */
  confirm?: (description: string) => Promise<boolean>
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentResult {
  text: string
  toolCalls: Array<{ toolName: string; input: unknown }>
  changes: ChangeSummary[]
  rolledBack: boolean
}

const BASE_SYSTEM = `你是 OpenFix，帮普通人排查并修复电脑问题的助手。
先用只读工具查清情况；确有必要时可调用"可逆"修复工具——会自动记录、可一键还原。
不要执行没把握的或不可逆的破坏性操作。最后用简短的大白话告诉用户你查到/改了什么。`

/**
 * 薄 agent loop：默认用 env 模型 + 内置网络工具；测试可注入 model/tools。
 * input 传字符串=单轮；传 ChatMessage[]=带上下文的多轮对话。
 */
export async function runAgent(
  input: string | ChatMessage[],
  deps: RunAgentDeps = {}
): Promise<AgentResult> {
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

  const result = await generateText({
    model,
    tools,
    system,
    ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
    stopWhen: stepCountIs(8)
  })

  // result.toolCalls 只含最后一步；跨所有步聚合才能拿到调查阶段的工具调用
  const allToolCalls = result.steps.flatMap((s) => s.toolCalls)
  const applied = changeLog.list()

  // 收尾安全策略：有"可逆"改动但复测没通过（或没复测）→ 自动还原可逆项
  // 不可逆改动（用户已确认）不参与自动回滚。
  const reversibleApplied = applied.filter((c) => c.riskLevel === 'reversible')
  let rolledBack = false
  if (reversibleApplied.length > 0 && verification.passed !== true) {
    await changeLog.rollbackReversible()
    rolledBack = true
  }

  let text = result.text
  if (rolledBack) {
    text = `${text}\n\n（修复没有通过复测，我已把改动全部还原，系统恢复原样。）`.trim()
  }

  return {
    text,
    toolCalls: allToolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
    changes: applied,
    rolledBack
  }
}
