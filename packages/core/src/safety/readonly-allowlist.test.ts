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

  it('环境检测命令放行（which/版本/包管理器读/defaults read/sysctl -a）', () => {
    expect(isReadOnlyAllowed('which', ['node']).allowed).toBe(true)
    expect(isReadOnlyAllowed('node', ['--version']).allowed).toBe(true)
    expect(isReadOnlyAllowed('git', ['status']).allowed).toBe(true)
    expect(isReadOnlyAllowed('npm', ['list']).allowed).toBe(true)
    expect(isReadOnlyAllowed('brew', ['list']).allowed).toBe(true)
    expect(isReadOnlyAllowed('defaults', ['read', 'com.apple.dock']).allowed).toBe(true)
    expect(isReadOnlyAllowed('sysctl', ['-a']).allowed).toBe(true)
  })

  it('解释器只准查版本，跑代码拒绝', () => {
    expect(isReadOnlyAllowed('node', ['-e', 'require("fs")']).allowed).toBe(false)
    expect(isReadOnlyAllowed('python3', ['-c', 'print(1)']).allowed).toBe(false)
  })

  it('双用命令的写子命令拒绝', () => {
    expect(isReadOnlyAllowed('git', ['commit', '-m', 'x']).allowed).toBe(false)
    expect(isReadOnlyAllowed('npm', ['install', 'lodash']).allowed).toBe(false)
    expect(isReadOnlyAllowed('brew', ['install', 'wget']).allowed).toBe(false)
    expect(isReadOnlyAllowed('defaults', ['write', 'x', 'y']).allowed).toBe(false)
    expect(isReadOnlyAllowed('sysctl', ['-w', 'x=1']).allowed).toBe(false)
  })

  it('敏感文件读取被隐私守卫拒绝', () => {
    expect(isReadOnlyAllowed('cat', ['/Users/me/.ssh/id_rsa']).allowed).toBe(false)
    expect(isReadOnlyAllowed('cat', ['~/.aws/credentials']).allowed).toBe(false)
    expect(isReadOnlyAllowed('cat', ['/etc/hosts']).allowed).toBe(true)
  })

  it('env/printenv 默认拒绝（避免环境变量里的密钥上云）', () => {
    expect(isReadOnlyAllowed('env', []).allowed).toBe(false)
    expect(isReadOnlyAllowed('printenv', []).allowed).toBe(false)
  })

  it('app 诊断只读命令放行，写子命令拒绝', () => {
    expect(isReadOnlyAllowed('mdls', ['/Applications/Safari.app']).allowed).toBe(true)
    expect(isReadOnlyAllowed('xattr', ['-p', 'com.apple.quarantine', '/Applications/X.app']).allowed).toBe(true)
    expect(isReadOnlyAllowed('xattr', ['-d', 'com.apple.quarantine', '/x']).allowed).toBe(false)
    expect(isReadOnlyAllowed('codesign', ['--verify', '/Applications/X.app']).allowed).toBe(true)
    expect(isReadOnlyAllowed('codesign', ['-s', 'id', '/x']).allowed).toBe(false)
    expect(isReadOnlyAllowed('plutil', ['-p', 'x.plist']).allowed).toBe(true)
    expect(isReadOnlyAllowed('plutil', ['-convert', 'xml1', 'x.plist']).allowed).toBe(false)
  })
})
