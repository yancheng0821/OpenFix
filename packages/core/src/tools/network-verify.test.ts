import { describe, it, expect } from 'vitest'
import type { ShellResult } from '../shell'
import { Verification } from '../safety/verification'
import { createNetworkVerifyTools } from './network-verify'

const okOptions = { toolCallId: 't1', messages: [] } as never

function shellWithPingCode(code: number): (c: string, a: string[]) => Promise<ShellResult> {
  return async () => ({ code, stdout: code === 0 ? 'time=10 ms' : 'Request timeout', stderr: '' })
}

describe('verify_connectivity', () => {
  it('ping 通：record(true) 且返回 reachable=true', async () => {
    const v = new Verification()
    const tools = createNetworkVerifyTools(shellWithPingCode(0), v)
    const res = await tools.verify_connectivity.execute!({ host: '8.8.8.8' }, okOptions)
    expect(res).toMatchObject({ host: '8.8.8.8', reachable: true })
    expect(v.passed).toBe(true)
  })

  it('ping 不通：record(false) 且返回 reachable=false', async () => {
    const v = new Verification()
    const tools = createNetworkVerifyTools(shellWithPingCode(2), v)
    const res = await tools.verify_connectivity.execute!({ host: '8.8.8.8' }, okOptions)
    expect(res).toMatchObject({ reachable: false })
    expect(v.passed).toBe(false)
  })
})
