import type { SkillPack } from './skill-pack.js'
import { createSystemFixTools } from '../tools/system-fix.js'

/** 软件/系统域技能包：诊断走通用 run_diagnostic，本包提供不可逆清理（需确认）。 */
export const systemSkillPack: SkillPack = {
  name: 'system',
  createTools: (ctx) => ({
    ...createSystemFixTools({ shell: ctx.shell, changeLog: ctx.changeLog, confirm: ctx.confirm })
  }),
  systemPrompt: `【软件/系统域】用 run_diagnostic 跑只读命令排查：df -h /（磁盘占用）、ls /Applications（软件是否安装）、ps aux（进程）、vm_stat（内存）。不可逆修复（需确认）：empty_trash（清空废纸篓）。`
}
