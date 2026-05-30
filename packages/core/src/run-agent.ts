import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai'
import { getModel } from './llm.js'
import { runReadOnly, type ShellRunner } from './shell.js'
import { createNetworkTools } from './tools/network.js'
import { createNetworkFixTools } from './tools/network-fix.js'
import { ChangeLog, type ChangeSummary } from './safety/change-log.js'
import { Verification } from './safety/verification.js'
import { createNetworkVerifyTools } from './tools/network-verify.js'

export interface RunAgentDeps {
  model?: LanguageModel
  tools?: ToolSet
  /** 注入 shell（测试用 mock，避免真实系统改动）；不传则用 runReadOnly。 */
  shell?: ShellRunner
  /** 注入 ChangeLog（main 进程持有，供运行结束后用户"一键还原"）；不传则内部新建。 */
  changeLog?: ChangeLog
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

const SYSTEM_PROMPT = `你是 OpenFix，帮普通人排查并修复电脑网络问题的助手。
先用只读工具查清情况；确有必要时可调用"可逆"修复工具（如改 DNS）——这类改动会自动记录、可一键还原。
执行任何修复后，必须调用 verify_connectivity 复测，只有复测通过才算修好。
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
  const tools =
    deps.tools ?? {
      ...createNetworkTools(shell),
      ...createNetworkFixTools({ shell, changeLog }),
      ...createNetworkVerifyTools(shell, verification)
    }

  const result = await generateText({
    model,
    tools,
    system: SYSTEM_PROMPT,
    ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
    stopWhen: stepCountIs(8)
  })

  // result.toolCalls 只含最后一步；跨所有步聚合才能拿到调查阶段的工具调用
  const allToolCalls = result.steps.flatMap((s) => s.toolCalls)
  const applied = changeLog.list()

  // 收尾安全策略：有改动但复测没通过（或没复测）→ 自动全部还原
  let rolledBack = false
  if (applied.length > 0 && verification.passed !== true) {
    await changeLog.rollbackAll()
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
