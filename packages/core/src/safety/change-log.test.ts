import { describe, it, expect } from 'vitest'
import { ChangeLog } from './change-log'

describe('ChangeLog', () => {
  it('list() 返回可序列化摘要（不含 rollback 函数）', () => {
    const log = new ChangeLog()
    log.record({ description: '改了 DNS', riskLevel: 'reversible', rollback: async () => {} })
    const list = log.list()
    expect(list).toEqual([{ id: 1, description: '改了 DNS', riskLevel: 'reversible' }])
    expect((list[0] as Record<string, unknown>).rollback).toBeUndefined()
  })

  it('rollbackAll() 以相反顺序调用各 rollback 并清空', async () => {
    const log = new ChangeLog()
    const order: number[] = []
    log.record({ description: 'A', riskLevel: 'reversible', rollback: async () => void order.push(1) })
    log.record({ description: 'B', riskLevel: 'reversible', rollback: async () => void order.push(2) })
    await log.rollbackAll()
    expect(order).toEqual([2, 1]) // 后改的先回滚（LIFO）
    expect(log.list()).toEqual([])
  })
})
