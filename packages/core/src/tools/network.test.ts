import { describe, it, expect } from 'vitest'
import type { ShellResult } from '../shell'
import { createNetworkTools } from './network'

const okOptions = { toolCallId: 't1', messages: [] } as never

describe('check_connectivity', () => {
  it('ping 成功时解析出 reachable 与延迟', async () => {
    const fakePing: ShellResult = {
      code: 0,
      stdout: '64 bytes from 8.8.8.8: icmp_seq=0 ttl=117 time=12.3 ms',
      stderr: ''
    }
    const tools = createNetworkTools(async () => fakePing)
    const res = await tools.check_connectivity.execute!({ host: '8.8.8.8' }, okOptions)
    expect(res).toMatchObject({ host: '8.8.8.8', reachable: true, latencyMs: 12.3 })
  })

  it('ping 失败时 reachable=false、延迟为 null', async () => {
    const fakePing: ShellResult = { code: 2, stdout: 'Request timeout', stderr: '' }
    const tools = createNetworkTools(async () => fakePing)
    const res = await tools.check_connectivity.execute!({ host: '10.0.0.99' }, okOptions)
    expect(res).toMatchObject({ host: '10.0.0.99', reachable: false, latencyMs: null })
  })
})
