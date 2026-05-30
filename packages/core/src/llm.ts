import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

/** 按 env 造一个 OpenAI 兼容的模型（baseURL/key/model 都可换，保证模型无关）。 */
export function getModel(): LanguageModel {
  const baseURL = process.env.OPENFIX_LLM_BASE_URL
  const apiKey = process.env.OPENFIX_LLM_API_KEY
  const modelId = process.env.OPENFIX_LLM_MODEL
  if (!baseURL || !apiKey || !modelId) {
    throw new Error(
      '缺少 LLM 配置：请在 .env 设置 OPENFIX_LLM_BASE_URL / OPENFIX_LLM_API_KEY / OPENFIX_LLM_MODEL'
    )
  }
  const provider = createOpenAICompatible({ name: 'openfix-llm', baseURL, apiKey })
  return provider(modelId)
}
