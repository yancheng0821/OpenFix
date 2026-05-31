import { describe, it, expect } from 'vitest'
import type { MemoryEntry } from '../memory/memory'
import { createMemoryTool } from './memory-tool'

const okOptions = { toolCallId: 't1', messages: [] } as never

describe('remember 工具', () => {
  it('普通条目：调一次写回调并返回"已记住"', async () => {
    const saved: MemoryEntry[] = []
    const tools = createMemoryTool(async (e) => {
      saved.push(e)
    })
    const out = (await tools.remember.execute!(
      { category: 'machine', note: '活动网卡 en7=AX88179B' },
      okOptions
    )) as string
    expect(out).toMatch(/已记住/)
    expect(saved).toEqual([{ category: 'machine', note: '活动网卡 en7=AX88179B' }])
  })

  it('敏感条目：不写、返回隐私提示', async () => {
    const saved: MemoryEntry[] = []
    const tools = createMemoryTool(async (e) => {
      saved.push(e)
    })
    const out = (await tools.remember.execute!(
      { category: 'preference', note: '我的密码是 abc123' },
      okOptions
    )) as string
    expect(out).toMatch(/隐私/)
    expect(saved).toEqual([])
  })
})
