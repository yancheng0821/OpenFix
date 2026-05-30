import { describe, it, expect } from 'vitest'
import type { ShellResult } from '../shell'
import { createNetworkDiagnosticTools } from './network-diagnostics'

const okOptions = { toolCallId: 't1', messages: [] } as never
const shellOut = (stdout: string) => async (): Promise<ShellResult> => ({ code: 0, stdout, stderr: '' })

describe('resolve_dns', () => {
  it('能解析：返回 resolved=true 与地址', async () => {
    const tools = createNetworkDiagnosticTools(shellOut('93.184.216.34\n'))
    const res = await tools.resolve_dns.execute!({ host: 'example.com' }, okOptions)
    expect(res).toMatchObject({ host: 'example.com', resolved: true, addresses: ['93.184.216.34'] })
  })

  it('解析失败：resolved=false、地址为空', async () => {
    const tools = createNetworkDiagnosticTools(shellOut(''))
    const res = await tools.resolve_dns.execute!({ host: 'nope.invalid' }, okOptions)
    expect(res).toMatchObject({ resolved: false, addresses: [] })
  })
})

describe('check_proxy', () => {
  it('代理开启：解析 enabled/server/port', async () => {
    const out = 'Enabled: Yes\nServer: 127.0.0.1\nPort: 7890\nAuthenticated Proxy Enabled: 0'
    const tools = createNetworkDiagnosticTools(shellOut(out))
    const res = await tools.check_proxy.execute!({ service: 'Wi-Fi' }, okOptions)
    expect(res).toMatchObject({ enabled: true, server: '127.0.0.1', port: '7890' })
  })

  it('代理关闭：enabled=false', async () => {
    const out = 'Enabled: No\nServer:\nPort: 0\nAuthenticated Proxy Enabled: 0'
    const tools = createNetworkDiagnosticTools(shellOut(out))
    const res = await tools.check_proxy.execute!({ service: 'Wi-Fi' }, okOptions)
    expect(res).toMatchObject({ enabled: false })
  })
})

describe('get_wifi_info', () => {
  it('已连接：解析 SSID', async () => {
    const tools = createNetworkDiagnosticTools(shellOut('Current Wi-Fi Network: MyHome-5G'))
    const res = await tools.get_wifi_info.execute!({ device: 'en0' }, okOptions)
    expect(res).toMatchObject({ connected: true, ssid: 'MyHome-5G' })
  })

  it('未连接：connected=false、ssid=null', async () => {
    const tools = createNetworkDiagnosticTools(
      shellOut('You are not associated with an AirPort network.')
    )
    const res = await tools.get_wifi_info.execute!({ device: 'en0' }, okOptions)
    expect(res).toMatchObject({ connected: false, ssid: null })
  })
})
