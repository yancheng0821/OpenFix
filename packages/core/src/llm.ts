import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export interface LLMConfig {
  baseURL: string
  apiKey: string
  model: string
}

/** 按配置造一个 OpenAI 兼容的模型（云端或本地 Ollama 皆可）。 */
export function createModel(cfg: LLMConfig): LanguageModel {
  const provider = createOpenAICompatible({
    name: 'openfix-llm',
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey
  })
  return provider(cfg.model)
}

/** 从 env 读配置造模型（main 未传 model 时的后备）。 */
export function getModel(): LanguageModel {
  const baseURL = process.env.OPENFIX_LLM_BASE_URL
  const apiKey = process.env.OPENFIX_LLM_API_KEY
  const model = process.env.OPENFIX_LLM_MODEL
  if (!baseURL || !apiKey || !model) {
    throw new Error(
      '缺少 LLM 配置：请在 .env 设置 OPENFIX_LLM_BASE_URL / OPENFIX_LLM_API_KEY / OPENFIX_LLM_MODEL'
    )
  }
  return createModel({ baseURL, apiKey, model })
}
