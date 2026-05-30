import { execFile } from 'node:child_process'

export interface ShellResult {
  code: number
  stdout: string
  stderr: string
}

/** 只读地执行一个命令。永不抛异常——把退出码原样返回，便于上层判断。 */
export type ShellRunner = (
  cmd: string,
  args: string[],
  timeoutMs?: number
) => Promise<ShellResult>

export const runReadOnly: ShellRunner = (cmd, args, timeoutMs = 5000) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const errCode = (err as NodeJS.ErrnoException | null)?.code
      const code = typeof errCode === 'number' ? errCode : err ? 1 : 0
      resolve({
        code,
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? ''
      })
    })
  })
