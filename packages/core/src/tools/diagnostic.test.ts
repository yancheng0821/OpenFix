import { describe, it, expect } from 'vitest'
import type { ShellResult } from '../shell'
import { createDiagnosticTools } from './diagnostic'

const okOptions = { toolCallId: 't1', messages: [] } as never

describe('run_diagnostic', () => {
  it('白名单内：执行并返回 stdout', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]): Promise<ShellResult> => {
      calls.push([cmd, ...args].join(' '))
      return { code: 0, stdout: '93.184.216.34', stderr: '' }
    }
    const tools = createDiagnosticTools(shell)
    const res = (await tools.run_diagnostic.execute!(
      { command: 'dig', args: ['+short', 'example.com'] },
      okOptions
    )) as { ok: boolean; stdout: string }
    expect(res.ok).toBe(true)
    expect(res.stdout).toBe('93.184.216.34')
    expect(calls).toEqual(['dig +short example.com'])
  })

  it('白名单外：拒绝执行、不调 shell', async () => {
    const calls: string[] = []
    const shell = async (cmd: string, args: string[]): Promise<ShellResult> => {
      calls.push(cmd)
      return { code: 0, stdout: '', stderr: '' }
    }
    const tools = createDiagnosticTools(shell)
    const res = (await tools.run_diagnostic.execute!(
      { command: 'rm', args: ['-rf', '/'] },
      okOptions
    )) as { ok: boolean; refused?: string }
    expect(res.ok).toBe(false)
    expect(res.refused).toBeTruthy()
    expect(calls).toEqual([])
  })
})
