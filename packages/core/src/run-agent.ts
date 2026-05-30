import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai'
import { getModel } from './llm.js'
import { runReadOnly, type ShellRunner } from './shell.js'
import { createNetworkTools } from './tools/network.js'
import { createNetworkFixTools } from './tools/network-fix.js'
import { ChangeLog, type ChangeSummary } from './safety/change-log.js'

export interface RunAgentDeps {
  model?: LanguageModel
  tools?: ToolSet
  /** 注入 shell（测试用 mock，避免真实系统改动）；不传则用 runReadOnly。 */
  shell?: ShellRunner
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentResult {
  text: string
  toolCalls: Array<{ toolName: string; input: unknown }>
  changes: ChangeSummary[]
}

const SYSTEM_PROMPT = `你是 OpenFix，帮普通人排查并修复电脑网络问题的助手。
先用只读工具查清情况；确有必要时可调用"可逆"修复工具（如改 DNS）——这类改动会自动记录、可一键还原。
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
  const changeLog = new ChangeLog()
  const tools =
    deps.tools ?? {
      ...createNetworkTools(shell),
      ...createNetworkFixTools({ shell, changeLog })
    }

  const result = await generateText({
    model,
    tools,
    system: SYSTEM_PROMPT,
    ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
    stopWhen: stepCountIs(5)
  })

  // result.toolCalls 只含最后一步；跨所有步聚合才能拿到调查阶段的工具调用
  const allToolCalls = result.steps.flatMap((s) => s.toolCalls)

  return {
    text: result.text,
    toolCalls: allToolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
    changes: changeLog.list()
  }
}
