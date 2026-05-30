export interface AllowResult {
  allowed: boolean
  reason?: string
}

/** 单纯只读、可直接放行的命令。 */
const ALWAYS_READONLY = new Set([
  'ping', 'dig', 'host', 'nslookup', 'traceroute', 'ifconfig', 'netstat', 'arp',
  'df', 'du', 'ls', 'ps', 'vm_stat', 'sw_vers', 'uname', 'system_profiler',
  'whoami', 'id', 'date', 'uptime', 'hostname', 'cat', 'head', 'tail'
])

/** 双用命令：只有满足条件的子命令/参数才算只读。 */
const GATED: Record<string, (args: string[]) => boolean> = {
  networksetup: (args) => /^-(get|list)/.test(args[0] ?? ''),
  pmset: (args) => args[0] === '-g',
  scutil: (args) => args.some((a) => a === '--dns' || a === '--proxy' || a === '--nwi'),
  top: (args) => args.includes('-l') // 需 -l <n> 一次性快照，非交互
}

/** 明确禁止（即便像"读"也拒绝，避免隐蔽写/任意执行）。 */
const NEVER = new Set([
  'rm', 'rmdir', 'mv', 'cp', 'dd', 'mkfs', 'kill', 'killall', 'shutdown', 'reboot',
  'osascript', 'sudo', 'sh', 'bash', 'zsh', 'curl', 'wget', 'defaults', 'launchctl',
  'diskutil', 'tmutil', 'chmod', 'chown', 'ln', 'touch'
])

/** 判断一条命令是否属于"可放行的只读诊断"。白名单制：未知一律拒绝。 */
export function isReadOnlyAllowed(command: string, args: string[]): AllowResult {
  if (NEVER.has(command)) {
    return { allowed: false, reason: `${command} 不是只读命令，请用专门的修复工具` }
  }
  if (ALWAYS_READONLY.has(command)) return { allowed: true }
  if (command in GATED) {
    return GATED[command](args)
      ? { allowed: true }
      : { allowed: false, reason: `${command} ${args[0] ?? ''} 不是只读子命令` }
  }
  return { allowed: false, reason: `${command} 不在只读白名单内（只读诊断只允许已知安全命令）` }
}
