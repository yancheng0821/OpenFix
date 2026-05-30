import type { ToolSet } from 'ai'
import type { ShellRunner } from '../shell.js'
import type { ChangeLog } from '../safety/change-log.js'
import type { Verification } from '../safety/verification.js'

/** 运行时注入给技能包的上下文。 */
export interface SkillContext {
  shell: ShellRunner
  changeLog: ChangeLog
  verification: Verification
}

/** 一个诊断/修复技能包：贡献工具 + 一段（可选）系统提示指导。 */
export interface SkillPack {
  name: string
  createTools: (ctx: SkillContext) => ToolSet
  systemPrompt?: string
}

/** 把多个技能包的工具合并成一个 ToolSet。 */
export function composeTools(packs: SkillPack[], ctx: SkillContext): ToolSet {
  return packs.reduce<ToolSet>((acc, p) => ({ ...acc, ...p.createTools(ctx) }), {})
}

/** 收集各包的非空系统提示片段，用空行拼接。 */
export function composeSystemPrompts(packs: SkillPack[]): string {
  return packs
    .map((p) => p.systemPrompt?.trim())
    .filter((s): s is string => Boolean(s))
    .join('\n\n')
}
