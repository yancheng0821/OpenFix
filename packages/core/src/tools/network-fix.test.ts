import { describe, it, expect } from 'vitest'
import { ChangeLog } from '../safety/change-log'
import type { ShellResult } from '../shell'
import { createNetworkFixTools } from './network-fix'

const okOptions = { toolCallId: 't1', messages: [] } as never

/** 记录 shell 调用、并按子命令返回设定输出。 */
function mockShell(getdnsOut: string): {
  shell: (c: string, a: string[]) => Promise<ShellResult>
  calls: string[]
} {
  const calls: string[] = []
  const shell = async (cmd: string, args: string[]): Promise<ShellResult> => {
    calls.push([cmd, ...args].join(' '))
    if (args.includes('-getdnsservers')) return { code: 0, stdout: getdnsOut, stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { shell, calls }
}

describe('set_dns_servers', () => {
  it('应用：先 get 快照，再 set 新 DNS，并记账', async () => {
    const { shell, calls } = mockShell('8.8.4.4\n8.8.8.8')
    const changeLog = new ChangeLog()
    const tools = createNetworkFixTools({ shell, changeLog })
    const out = (await tools.set_dns_servers.execute!(
      { service: 'Wi-Fi', servers: ['1.1.1.1'] },
      okOptions
    )) as string

    expect(out).toMatch(/1\.1\.1\.1/)
    expect(calls).toContain('networksetup -getdnsservers Wi-Fi')
    expect(calls).toContain('networksetup -setdnsservers Wi-Fi 1.1.1.1')
    expect(changeLog.list()).toHaveLength(1)
  })

  it('回滚：恢复到快照里的原 DNS', async () => {
    const { shell, calls } = mockShell('8.8.4.4\n8.8.8.8')
    const changeLog = new ChangeLog()
    const tools = createNetworkFixTools({ shell, changeLog })
    await tools.set_dns_servers.execute!({ service: 'Wi-Fi', servers: ['1.1.1.1'] }, okOptions)
    await changeLog.rollbackAll()
    expect(calls).toContain('networksetup -setdnsservers Wi-Fi 8.8.4.4 8.8.8.8')
  })

  it('原本没有 DNS：回滚用 Empty 清空', async () => {
    const { shell, calls } = mockShell("There aren't any DNS Servers set on Wi-Fi.")
    const changeLog = new ChangeLog()
    const tools = createNetworkFixTools({ shell, changeLog })
    await tools.set_dns_servers.execute!({ service: 'Wi-Fi', servers: ['1.1.1.1'] }, okOptions)
    await changeLog.rollbackAll()
    expect(calls).toContain('networksetup -setdnsservers Wi-Fi Empty')
  })
})
