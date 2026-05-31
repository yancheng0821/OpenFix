import { z } from 'zod'
import { tool, type ToolSet } from 'ai'
import type { WriteToolContext } from '../safety/write-tool.js'

/**
 * 通用"确认闸"修复：当没有专门修复工具时，由模型提出一条修复命令 + 对应撤销命令，
 * 必须经用户确认后才执行；执行后按"可还原"记账（撤销命令为模型给出，尽力而为）。
 */
export function createProposeFixTool(ctx: WriteToolContext): ToolSet {
  return {
    propose_fix: tool({
      description:
        '当没有专门的修复工具能解决问题时，提出一条修复命令来执行——必须经用户确认，并必须同时给出撤销命令以便回滚。仅用于有把握的修复，命令越具体越好，避免破坏性的不可逆操作。',
      inputSchema: z.object({
        description: z.string().describe('用大白话说明这条修复做什么（给用户确认时看）'),
        command: z.string().describe('修复命令名，如 networksetup'),
        args: z.array(z.string()).default([]).describe('命令参数数组'),
        undo_command: z.string().describe('撤销命令名'),
        undo_args: z.array(z.string()).default([]).describe('撤销命令参数数组')
      }),
      execute: async ({ description, command, args, undo_command, undo_args }) => {
        const shown = `${description}\n将执行：${command} ${args.join(' ')}`.trim()
        const ok = ctx.confirm ? await ctx.confirm(shown) : false
        if (!ok) return `已拒绝执行（此修复需你确认，未获授权）：${description}`
        await ctx.shell(command, args, 20000)
        ctx.changeLog.record({
          description,
          riskLevel: 'reversible',
          // 用户已确认，且这类操作（装软件/改配置）没有连通性复测——别被"没复测"安全网误回滚；
          // 留给用户手动一键还原。
          autoRevert: false,
          rollback: async () => {
            await ctx.shell(undo_command, undo_args, 20000)
          }
        })
        return `已执行：${description}`
      }
    })
  }
}
