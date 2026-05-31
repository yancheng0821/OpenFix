import type { SkillPack } from './skill-pack.js'
import { createSystemFixTools } from '../tools/system-fix.js'

/** 软件/系统域技能包：诊断走通用 run_diagnostic，本包提供不可逆清理（需确认）。 */
export const systemSkillPack: SkillPack = {
  name: 'system',
  createTools: (ctx) => ({
    ...createSystemFixTools({ shell: ctx.shell, changeLog: ctx.changeLog, confirm: ctx.confirm })
  }),
  systemPrompt: `【软件/系统域】用 run_diagnostic 跑只读命令排查：df -h /（磁盘占用）、ls /Applications（软件是否安装）、ps aux（进程）、vm_stat（内存）。修复：empty_trash（清空废纸篓，不可逆需确认）、kill_process（结束卡死/吃资源的进程，需确认；先用 ps/top 查 PID）、restart_finder / restart_dock（重启访达/程序坞，安全自恢复）、open_app（打开 App）、open_url（打开网址）。
程序打不开：先 run_diagnostic 查 xattr -p com.apple.quarantine <app路径>（是否被隔离）、codesign --verify <app>、ls ~/Library/Logs/DiagnosticReports（崩溃日志）；可用 open_app 尝试启动；"已损坏/未受信任开发者"用 propose_fix 跑 xattr -dr com.apple.quarantine <app路径>。
装/更新软件：先 run_diagnostic 跑 brew --version 看有无 Homebrew，有则用 propose_fix 跑 brew install/upgrade（撤销 brew uninstall）；没有就用 open_url 打开官方下载页让用户自己装。
找配置/菜单位置：直接用大白话告诉用户（通常在 菜单栏 App名→设置/偏好设置 ⌘,）。`
}
