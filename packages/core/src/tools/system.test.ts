import { describe, it, expect } from 'vitest'
import type { ShellResult } from '../shell'
import { createSystemTools } from './system'

const okOptions = { toolCallId: 't1', messages: [] } as never

function shellReturning(map: Record<string, string>): (c: string, a: string[]) => Promise<ShellResult> {
  return async (cmd) => ({ code: 0, stdout: map[cmd] ?? '', stderr: '' })
}

describe('check_disk_space', () => {
  it('解析 df -h 根分区的 size/used/avail/percent', async () => {
    const df = 'Filesystem Size Used Avail Capacity Mounted\n/dev/disk3 926Gi 10Gi 300Gi 4% /'
    const tools = createSystemTools(shellReturning({ df }))
    const res = await tools.check_disk_space.execute!({}, okOptions)
    expect(res).toMatchObject({ size: '926Gi', used: '10Gi', available: '300Gi', usedPercent: '4%' })
  })
})

describe('check_app_installed', () => {
  it('在 /Applications 里大小写不敏感匹配 → installed=true', async () => {
    const ls = 'Google Chrome.app\nSafari.app\n微信.app'
    const tools = createSystemTools(shellReturning({ ls }))
    const res = await tools.check_app_installed.execute!({ name: 'chrome' }, okOptions)
    expect(res).toMatchObject({ name: 'chrome', installed: true, matches: ['Google Chrome.app'] })
  })

  it('找不到 → installed=false、matches 为空', async () => {
    const ls = 'Safari.app\n微信.app'
    const tools = createSystemTools(shellReturning({ ls }))
    const res = await tools.check_app_installed.execute!({ name: 'Firefox' }, okOptions)
    expect(res).toMatchObject({ name: 'Firefox', installed: false, matches: [] })
  })
})
