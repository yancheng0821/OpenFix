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

  it('rollbackReversible 只回滚可逆项，保留不可逆记录', async () => {
    const log = new ChangeLog()
    const order: string[] = []
    log.record({ description: 'rev', riskLevel: 'reversible', rollback: async () => void order.push('rev') })
    log.record({ description: 'irr', riskLevel: 'irreversible', rollback: async () => void order.push('irr') })
    await log.rollbackReversible()
    expect(order).toEqual(['rev']) // 只回滚可逆
    expect(log.list().map((c) => c.riskLevel)).toEqual(['irreversible']) // 不可逆记录保留
  })

  it('rollbackAutoRevert 只回滚自动型(autoRevert!==false)，保留用户确认型', async () => {
    const log = new ChangeLog()
    const order: string[] = []
    log.record({
      description: '装软件',
      riskLevel: 'reversible',
      autoRevert: false,
      rollback: async () => void order.push('install')
    })
    log.record({
      description: '改 DNS',
      riskLevel: 'reversible',
      rollback: async () => void order.push('dns')
    })
    const did = await log.rollbackAutoRevert()
    expect(did).toBe(true)
    expect(order).toEqual(['dns']) // 只回滚自动型
    expect(log.list().map((c) => c.description)).toEqual(['装软件']) // 确认型保留，可手动还原
  })
})
