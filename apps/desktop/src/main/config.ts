import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { LLMConfig } from '@openfix/core'

export interface AppConfig {
  /** 云端模型（默认、全能力）。 */
  cloud: LLMConfig
  /** 本地模型（断网自动回退用，仅网络包）。 */
  local: { baseURL: string; model: string }
}

const file = (): string => join(app.getPath('userData'), 'openfix-config.json')

function defaults(): AppConfig {
  return {
    cloud: {
      baseURL: process.env.OPENFIX_LLM_BASE_URL ?? '',
      apiKey: process.env.OPENFIX_LLM_API_KEY ?? '',
      model: process.env.OPENFIX_LLM_MODEL ?? ''
    },
    local: { baseURL: 'http://localhost:11434/v1', model: 'qwen3:8b' }
  }
}

/** 读配置：文件优先，缺项用默认（默认 cloud 取 env）。 */
export function loadConfig(): AppConfig {
  const d = defaults()
  try {
    if (existsSync(file())) {
      const saved = JSON.parse(readFileSync(file(), 'utf-8')) as Partial<AppConfig>
      return {
        cloud: { ...d.cloud, ...saved.cloud },
        local: { ...d.local, ...saved.local }
      }
    }
  } catch {
    // 配置损坏 → 用默认
  }
  return d
}

export function saveConfig(cfg: AppConfig): void {
  writeFileSync(file(), JSON.stringify(cfg, null, 2), 'utf-8')
}
