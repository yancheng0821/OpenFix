import { describe, it, expect } from 'vitest'
import { ChangeLog } from '../safety/change-log'
import type { ShellResult } from '../shell'
import { createNetworkFixTools, serviceForDevice, deviceForHardwarePort } from './network-fix'

const okOptions = { toolCallId: 't1', messages: [] } as never

const SERVICE_ORDER = `An asterisk (*) denotes that a network service is disabled.
(1) Wi-Fi
(Hardware Port: Wi-Fi, Device: en0)

(2) USB 10/100/1000 LAN
(Hardware Port: USB 10/100/1000 LAN, Device: en7)
`

const HARDWARE_PORTS = `Hardware Port: Wi-Fi
Device: en1
Ethernet Address: aa:bb

Hardware Port: USB 10/100/1000 LAN
Device: en7
`

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

function flexShell(outs: { proxy?: string; power?: string }): {
  shell: (c: string, a: string[]) => Promise<ShellResult>
  calls: string[]
} {
  const calls: string[] = []
  const shell = async (cmd: string, args: string[]): Promise<ShellResult> => {
    calls.push([cmd, ...args].join(' '))
    if (args.includes('-getwebproxy') || args.includes('-getsecurewebproxy')) {
      return { code: 0, stdout: outs.proxy ?? '', stderr: '' }
    }
    if (args.includes('-getairportpower')) return { code: 0, stdout: outs.power ?? '', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { shell, calls }
}

describe('clear_proxy', () => {
  it('关闭代理：先快照，再关 web+secure，并记账', async () => {
    const { shell, calls } = flexShell({ proxy: 'Enabled: Yes\nServer: 127.0.0.1\nPort: 7890' })
    const changeLog = new ChangeLog()
    const tools = createNetworkFixTools({ shell, changeLog })
    await tools.clear_proxy.execute!({ service: 'Wi-Fi' }, okOptions)
    expect(calls).toContain('networksetup -setwebproxystate Wi-Fi off')
    expect(calls).toContain('networksetup -setsecurewebproxystate Wi-Fi off')
    expect(changeLog.list()).toHaveLength(1)
  })

  it('回滚：原本开着 → 恢复代理 server/port', async () => {
    const { shell, calls } = flexShell({ proxy: 'Enabled: Yes\nServer: 127.0.0.1\nPort: 7890' })
    const changeLog = new ChangeLog()
    const tools = createNetworkFixTools({ shell, changeLog })
    await tools.clear_proxy.execute!({ service: 'Wi-Fi' }, okOptions)
    await changeLog.rollbackAll()
    expect(calls).toContain('networksetup -setwebproxy Wi-Fi 127.0.0.1 7890')
  })
})

describe('restart_wifi', () => {
  it('重启 Wi-Fi：先 off 再 on', async () => {
    const { shell, calls } = flexShell({ power: 'Wi-Fi Power (en0): On' })
    const changeLog = new ChangeLog()
    const tools = createNetworkFixTools({ shell, changeLog })
    await tools.restart_wifi.execute!({ device: 'en0' }, okOptions)
    expect(calls).toContain('networksetup -setairportpower en0 off')
    expect(calls).toContain('networksetup -setairportpower en0 on')
    expect(changeLog.list()).toHaveLength(1)
  })

  it('省略 device：自动探测 Wi-Fi 设备（en1）', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]): Promise<ShellResult> => {
      calls.push([cmd, ...args].join(' '))
      if (args.includes('-listallhardwareports'))
        return { code: 0, stdout: HARDWARE_PORTS, stderr: '' }
      return { code: 0, stdout: 'Wi-Fi Power (en1): On', stderr: '' }
    }
    const tools = createNetworkFixTools({ shell, changeLog: new ChangeLog() })
    await tools.restart_wifi.execute!({}, okOptions)
    expect(calls).toContain('networksetup -setairportpower en1 off')
    expect(calls).toContain('networksetup -setairportpower en1 on')
  })
})

describe('活动网卡解析', () => {
  it('serviceForDevice：按 enX 找到服务名', () => {
    expect(serviceForDevice(SERVICE_ORDER, 'en7')).toBe('USB 10/100/1000 LAN')
    expect(serviceForDevice(SERVICE_ORDER, 'en0')).toBe('Wi-Fi')
    expect(serviceForDevice(SERVICE_ORDER, 'en9')).toBeNull()
  })

  it('deviceForHardwarePort：按端口名找到设备名', () => {
    expect(deviceForHardwarePort(HARDWARE_PORTS, 'Wi-Fi')).toBe('en1')
    expect(deviceForHardwarePort(HARDWARE_PORTS, 'USB 10/100/1000 LAN')).toBe('en7')
  })

  it('set_dns_servers 省略 service：作用于默认路由所在网卡（以太网 en7）而非写死 Wi-Fi', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]): Promise<ShellResult> => {
      calls.push([cmd, ...args].join(' '))
      if (cmd === 'route') return { code: 0, stdout: 'gateway: 1.2.3.1\n  interface: en7\n', stderr: '' }
      if (args.includes('-listnetworkserviceorder'))
        return { code: 0, stdout: SERVICE_ORDER, stderr: '' }
      if (args.includes('-getdnsservers'))
        return { code: 0, stdout: "There aren't any DNS Servers set.", stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
    const tools = createNetworkFixTools({ shell, changeLog: new ChangeLog() })
    const out = (await tools.set_dns_servers.execute!({ servers: ['1.1.1.1'] }, okOptions)) as string
    expect(calls).toContain('networksetup -setdnsservers USB 10/100/1000 LAN 1.1.1.1')
    expect(calls).not.toContain('networksetup -setdnsservers Wi-Fi 1.1.1.1')
    expect(out).toMatch(/USB 10\/100\/1000 LAN/)
  })
})
