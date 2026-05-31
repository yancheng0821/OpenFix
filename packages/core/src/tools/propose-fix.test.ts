import { describe, it, expect } from 'vitest'
import { ChangeLog } from '../safety/change-log'
import { createProposeFixTool } from './propose-fix'

const okOptions = { toolCallId: 't1', messages: [] } as never
const input = {
  description: '关闭挡路的代理',
  command: 'networksetup',
  args: ['-setwebproxystate', 'Wi-Fi', 'off'],
  undo_command: 'networksetup',
  undo_args: ['-setwebproxystate', 'Wi-Fi', 'on']
}

describe('propose_fix', () => {
  it('已授权：执行命令并按可还原记账', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '))
      return { code: 0, stdout: '', stderr: '' }
    }
    const changeLog = new ChangeLog()
    const tools = createProposeFixTool({ shell, changeLog, confirm: async () => true })
    const out = (await tools.propose_fix.execute!(input, okOptions)) as string
    expect(out).toMatch(/已执行/)
    expect(calls).toContain('networksetup -setwebproxystate Wi-Fi off')
    expect(changeLog.list()).toEqual([
      { id: 1, description: '关闭挡路的代理', riskLevel: 'reversible' }
    ])
  })

  it('回滚：跑模型给的撤销命令', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '))
      return { code: 0, stdout: '', stderr: '' }
    }
    const changeLog = new ChangeLog()
    const tools = createProposeFixTool({ shell, changeLog, confirm: async () => true })
    await tools.propose_fix.execute!(input, okOptions)
    await changeLog.rollbackReversible()
    expect(calls).toContain('networksetup -setwebproxystate Wi-Fi on')
  })

  it('未授权（confirm 缺省）：拒绝，不执行、不记账', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '))
      return { code: 0, stdout: '', stderr: '' }
    }
    const changeLog = new ChangeLog()
    const tools = createProposeFixTool({ shell, changeLog })
    const out = (await tools.propose_fix.execute!(input, okOptions)) as string
    expect(out).toMatch(/拒绝|未获授权/)
    expect(calls).toEqual([])
    expect(changeLog.list()).toEqual([])
  })
})
