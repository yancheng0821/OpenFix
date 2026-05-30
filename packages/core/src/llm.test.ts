import { describe, it, expect, afterEach } from 'vitest'
import { getModel } from './llm'

const KEYS = ['OPENFIX_LLM_BASE_URL', 'OPENFIX_LLM_API_KEY', 'OPENFIX_LLM_MODEL'] as const

function clearEnv(): void {
  for (const k of KEYS) delete process.env[k]
}

afterEach(clearEnv)

describe('getModel', () => {
  it('缺少任一配置时抛出清晰错误', () => {
    clearEnv()
    process.env.OPENFIX_LLM_BASE_URL = 'https://example.com/v1'
    expect(() => getModel()).toThrow(/OPENFIX_LLM/)
  })

  it('配置齐全时返回一个模型对象', () => {
    process.env.OPENFIX_LLM_BASE_URL = 'https://example.com/v1'
    process.env.OPENFIX_LLM_API_KEY = 'sk-test'
    process.env.OPENFIX_LLM_MODEL = 'gpt-test'
    const model = getModel()
    expect(model).toBeTruthy()
  })
})
