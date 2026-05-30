import type { SkillPack } from './skill-pack.js'
import { createSystemTools } from '../tools/system.js'
import { createSystemFixTools } from '../tools/system-fix.js'

/** 软件/系统域技能包（只读诊断 + 不可逆清理）。 */
export const systemSkillPack: SkillPack = {
  name: 'system',
  createTools: (ctx) => ({
    ...createSystemTools(ctx.shell),
    ...createSystemFixTools({ shell: ctx.shell, changeLog: ctx.changeLog, confirm: ctx.confirm })
  }),
  systemPrompt: `【软件/系统域】只读诊断：check_disk_space（磁盘占用）、check_app_installed（软件是否安装）。修复：empty_trash（清空废纸篓，不可撤销，需用户确认）。`
}
