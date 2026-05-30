import { tool, type Tool } from 'ai'
import { z } from 'zod'
import type { ShellRunner } from '../shell.js'
import type { ChangeLog, RiskLevel } from './change-log.js'

/** 每次运行注入给写工具的上下文：shell、账本、（不可逆操作用的）确认回调。 */
export interface WriteToolContext {
  shell: ShellRunner
  changeLog: ChangeLog
  confirm?: (description: string) => Promise<boolean>
}

export interface WriteToolSpec<S extends z.ZodTypeAny> {
  description: string
  inputSchema: S
  riskLevel: RiskLevel
  describe: (input: z.infer<S>) => string
  snapshot: (input: z.infer<S>, shell: ShellRunner) => Promise<unknown>
  apply: (input: z.infer<S>, shell: ShellRunner) => Promise<string>
  rollback: (snapshot: unknown, input: z.infer<S>, shell: ShellRunner) => Promise<void>
}

/** 把一个写操作包成 AI SDK 工具：可逆自动执行+快照记账；不可逆需 confirm，否则拒绝。 */
export function createWriteTool<S extends z.ZodTypeAny>(
  spec: WriteToolSpec<S>,
  ctx: WriteToolContext
): Tool {
  return tool({
    description: spec.description,
    inputSchema: spec.inputSchema,
    execute: async (input: z.infer<S>) => {
      const desc = spec.describe(input)
      if (spec.riskLevel === 'irreversible') {
        const ok = ctx.confirm ? await ctx.confirm(desc) : false
        if (!ok) return `已拒绝执行（不可逆操作需用户确认，未获授权）：${desc}`
      }
      const snap = await spec.snapshot(input, ctx.shell)
      const result = await spec.apply(input, ctx.shell)
      ctx.changeLog.record({
        description: desc,
        riskLevel: spec.riskLevel,
        rollback: () => spec.rollback(snap, input, ctx.shell)
      })
      return result
    }
  })
}
