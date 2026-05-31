import { describe, it, expect } from 'vitest'
import { ChangeLog } from '../safety/change-log'
import { createSystemFixTools } from './system-fix'

const okOptions = { toolCallId: 't1', messages: [] } as never

describe('empty_trash', () => {
  it('已授权：调 Finder 清空并记一条不可逆改动', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '))
      return { code: 0, stdout: '', stderr: '' }
    }
    const changeLog = new ChangeLog()
    const tools = createSystemFixTools({ shell, changeLog, confirm: async () => true })
    const out = (await tools.empty_trash.execute!({}, okOptions)) as string
    expect(out).toMatch(/废纸篓/)
    expect(calls.some((c) => c.includes('Finder') && c.includes('empty trash'))).toBe(true)
    expect(changeLog.list()).toEqual([
      { id: 1, description: expect.stringMatching(/废纸篓/), riskLevel: 'irreversible' }
    ])
  })

  it('未授权（confirm 缺省）：拒绝，不调 shell、不记账', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '))
      return { code: 0, stdout: '', stderr: '' }
    }
    const changeLog = new ChangeLog()
    const tools = createSystemFixTools({ shell, changeLog })
    const out = (await tools.empty_trash.execute!({}, okOptions)) as string
    expect(out).toMatch(/拒绝|未获授权/)
    expect(calls).toEqual([])
    expect(changeLog.list()).toEqual([])
  })
})

describe('kill_process', () => {
  it('已授权：kill 指定 PID 并记一条不可逆改动', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '))
      return { code: 0, stdout: '', stderr: '' }
    }
    const changeLog = new ChangeLog()
    const tools = createSystemFixTools({ shell, changeLog, confirm: async () => true })
    await tools.kill_process.execute!({ pid: 1234 }, okOptions)
    expect(calls).toContain('kill 1234')
    expect(changeLog.list()[0]).toMatchObject({ riskLevel: 'irreversible' })
  })

  it('未授权：拒绝，不 kill', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '))
      return { code: 0, stdout: '', stderr: '' }
    }
    const changeLog = new ChangeLog()
    const tools = createSystemFixTools({ shell, changeLog })
    const out = (await tools.kill_process.execute!({ pid: 1234 }, okOptions)) as string
    expect(out).toMatch(/拒绝|未获授权/)
    expect(calls).toEqual([])
  })
})

describe('restart_finder（safe）', () => {
  it('直接执行、不需确认、不记账', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '))
      return { code: 0, stdout: '', stderr: '' }
    }
    const changeLog = new ChangeLog()
    const tools = createSystemFixTools({ shell, changeLog }) // 无 confirm
    await tools.restart_finder.execute!({}, okOptions)
    expect(calls).toContain('killall Finder')
    expect(changeLog.list()).toEqual([])
  })
})
