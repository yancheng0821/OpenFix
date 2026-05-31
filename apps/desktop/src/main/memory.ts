import { app, shell } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { applyMemory, SCAFFOLD, type MemoryEntry } from '@openfix/core'

export function memoryPath(): string {
  return join(app.getPath('userData'), 'openfix-memory.md')
}

/** 读记忆内容；缺失/损坏 → 空串（不阻断运行）。 */
export function readMemory(): string {
  try {
    if (existsSync(memoryPath())) return readFileSync(memoryPath(), 'utf-8')
  } catch {
    // 损坏当作空
  }
  return ''
}

/** 追加一条记忆（敏感/重复由 core 的 applyMemory 决定跳过）；写失败吞掉。 */
export function appendMemory(entry: MemoryEntry): void {
  try {
    const next = applyMemory(readMemory(), entry)
    if (next !== null) writeFileSync(memoryPath(), next, 'utf-8')
  } catch {
    // 记忆是增强项，写失败不影响主流程
  }
}

/** 用默认编辑器打开记忆文件（不存在则先建脚手架）。 */
export function openMemory(): void {
  try {
    if (!existsSync(memoryPath())) writeFileSync(memoryPath(), SCAFFOLD, 'utf-8')
    void shell.openPath(memoryPath())
  } catch {
    // 打开失败忽略
  }
}
