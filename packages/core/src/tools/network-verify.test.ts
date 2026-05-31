import { describe, it, expect } from 'vitest'
import type { ShellResult } from '../shell'
import { Verification } from '../safety/verification'
import { createNetworkVerifyTools } from './network-verify'

const okOptions = { toolCallId: 't1', messages: [] } as never

/** mock curl：按给定的退出码与 http_code 返回。 */
function shellWithCurl(code: number, httpCode: string): {
  shell: (c: string, a: string[]) => Promise<ShellResult>
  calls: string[]
} {
  const calls: string[] = []
  const shell = async (cmd: string, args: string[]): Promise<ShellResult> => {
    calls.push([cmd, ...args].join(' '))
    return { code, stdout: httpCode, stderr: '' }
  }
  return { shell, calls }
}

describe('verify_connectivity', () => {
  it('HTTP 200：record(true) 且 reachable=true', async () => {
    const v = new Verification()
    const { shell, calls } = shellWithCurl(0, '200')
    const tools = createNetworkVerifyTools(shell, v)
    const res = await tools.verify_connectivity.execute!({}, okOptions)
    expect(res).toMatchObject({ reachable: true, status: '200' })
    expect(v.passed).toBe(true)
    expect(calls.some((c) => c.startsWith('curl'))).toBe(true)
  })

  it('curl 失败（http_code 000）：record(false) 且 reachable=false', async () => {
    const v = new Verification()
    const { shell } = shellWithCurl(7, '000')
    const tools = createNetworkVerifyTools(shell, v)
    const res = await tools.verify_connectivity.execute!({}, okOptions)
    expect(res).toMatchObject({ reachable: false })
    expect(v.passed).toBe(false)
  })

  it('能 ping 通但 HTTP 不通（如 DNS 劫持/代理挡路）：仍判未修好', async () => {
    // curl 退出码非 0、http_code 不是 2xx/3xx —— 不会误判为已修复
    const v = new Verification()
    const { shell } = shellWithCurl(28, '000')
    const tools = createNetworkVerifyTools(shell, v)
    const res = await tools.verify_connectivity.execute!({ url: 'https://www.google.com' }, okOptions)
    expect(res).toMatchObject({ reachable: false })
    expect(v.passed).toBe(false)
  })
})
