import type { SkillPack } from './skill-pack.js'
import { createSystemTools } from '../tools/system.js'

/** 软件/系统域技能包（首批只读诊断）。 */
export const systemSkillPack: SkillPack = {
  name: 'system',
  createTools: (ctx) => createSystemTools(ctx.shell),
  systemPrompt: `【软件/系统域】只读诊断工具：check_disk_space（磁盘占用）、check_app_installed（某图形软件是否安装）。`
}
