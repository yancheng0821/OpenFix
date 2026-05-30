import { describe, it, expect } from 'vitest'
import { isReadOnlyAllowed } from './readonly-allowlist'

describe('isReadOnlyAllowed', () => {
  it('单纯只读命令放行', () => {
    expect(isReadOnlyAllowed('ping', ['8.8.8.8']).allowed).toBe(true)
    expect(isReadOnlyAllowed('dig', ['+short', 'github.com']).allowed).toBe(true)
    expect(isReadOnlyAllowed('df', ['-h', '/']).allowed).toBe(true)
  })

  it('双用命令：只读子命令放行、写子命令拒绝', () => {
    expect(isReadOnlyAllowed('networksetup', ['-getdnsservers', 'Wi-Fi']).allowed).toBe(true)
    expect(isReadOnlyAllowed('networksetup', ['-setdnsservers', 'Wi-Fi', '1.1.1.1']).allowed).toBe(false)
    expect(isReadOnlyAllowed('pmset', ['-g']).allowed).toBe(true)
    expect(isReadOnlyAllowed('pmset', ['-a', 'sleep', '0']).allowed).toBe(false)
  })

  it('明确危险命令拒绝', () => {
    expect(isReadOnlyAllowed('rm', ['-rf', '/']).allowed).toBe(false)
    expect(isReadOnlyAllowed('osascript', ['-e', 'x']).allowed).toBe(false)
    expect(isReadOnlyAllowed('sh', ['-c', 'rm x']).allowed).toBe(false)
  })

  it('未知命令默认拒绝（白名单制）', () => {
    const r = isReadOnlyAllowed('frobnicate', [])
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/白名单/)
  })
})
