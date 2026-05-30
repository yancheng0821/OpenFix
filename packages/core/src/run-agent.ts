import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai'
import { getModel } from './llm.js'
import { runReadOnly } from './shell.js'
import { createNetworkTools } from './tools/network.js'

export interface RunAgentDeps {
  model?: LanguageModel
  tools?: ToolSet
}

export interface AgentResult {
  text: string
  toolCalls: Array<{ toolName: string; input: unknown }>
}

const SYSTEM_PROMPT = `你是 OpenFix，帮普通人排查电脑网络问题的助手。
目前只有"只读诊断"工具，不会改动任何系统配置。
请先用工具查清实际情况，再用简短的大白话把结论告诉用户。不要假装执行了修复。`

/** 薄 agent loop：默认用 env 模型 + 内置网络工具；测试可注入 model/tools。 */
export async function runAgent(userText: string, deps: RunAgentDeps = {}): Promise<AgentResult> {
  const model = deps.model ?? getModel()
  const tools = deps.tools ?? createNetworkTools(runReadOnly)

  const result = await generateText({
    model,
    tools,
    system: SYSTEM_PROMPT,
    prompt: userText,
    stopWhen: stepCountIs(5)
  })

  // result.toolCalls 只含最后一步；跨所有步聚合才能拿到调查阶段的工具调用
  const allToolCalls = result.steps.flatMap((s) => s.toolCalls)

  return {
    text: result.text,
    toolCalls: allToolCalls.map((c) => ({ toolName: c.toolName, input: c.input }))
  }
}
