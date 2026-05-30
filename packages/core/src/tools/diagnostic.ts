import { z } from 'zod'
import { tool, type ToolSet } from 'ai'
import type { ShellRunner } from '../shell.js'
import { isReadOnlyAllowed } from '../safety/readonly-allowlist.js'

/** 通用只读诊断工具：模型自由跑只读命令，由白名单门控。 */
export function createDiagnosticTools(shell: ShellRunner): ToolSet {
  return {
    run_diagnostic: tool({
      description:
        '运行一条只读诊断命令来排查问题（如 dig/ping/df/networksetup -get*/scutil --dns 等）。只允许只读命令；要修复请用专门的修复工具。命令名与参数分开传，不要用管道/重定向。',
      inputSchema: z.object({
        command: z.string().describe('命令名，如 dig、ping、df、networksetup'),
        args: z.array(z.string()).default([]).describe('参数数组，如 ["+short","github.com"]')
      }),
      execute: async ({ command, args }) => {
        const gate = isReadOnlyAllowed(command, args)
        if (!gate.allowed) return { ok: false as const, refused: gate.reason }
        const r = await shell(command, args, 8000)
        return {
          ok: true as const,
          command: `${command} ${args.join(' ')}`.trim(),
          code: r.code,
          stdout: r.stdout.trim(),
          stderr: r.stderr.trim()
        }
      }
    })
  }
}
