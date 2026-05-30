import { describe, it, expect } from 'vitest'
import { runReadOnly } from './shell'

describe('runReadOnly', () => {
  it('返回命令的 stdout 和 code=0', async () => {
    const r = await runReadOnly('echo', ['hello'])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('hello\n')
  })

  it('非零退出码原样返回，不抛异常', async () => {
    const r = await runReadOnly('sh', ['-c', 'exit 3'])
    expect(r.code).toBe(3)
  })
})
