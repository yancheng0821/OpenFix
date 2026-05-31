export interface AllowResult {
  allowed: boolean
  reason?: string
}

/** 单纯只读、可直接放行的命令（不能执行任意代码、不能写）。 */
const ALWAYS_READONLY = new Set([
  // 网络
  'ping', 'dig', 'host', 'nslookup', 'traceroute', 'ifconfig', 'netstat', 'arp',
  // 磁盘/文件信息
  'df', 'du', 'ls', 'stat', 'file', 'wc', 'grep', 'mount', 'lsof',
  // 系统/环境信息
  'ps', 'vm_stat', 'sw_vers', 'uname', 'system_profiler', 'ioreg', 'getconf',
  'arch', 'locale', 'groups', 'whoami', 'id', 'date', 'uptime', 'hostname',
  'which', 'mdfind', 'last',
  // 文件内容（受下方敏感路径守卫约束）
  'cat', 'head', 'tail'
])

/** 读取文件内容的命令：需额外做敏感路径守卫。 */
const FILE_READERS = new Set(['cat', 'head', 'tail', 'grep', 'file', 'stat'])

/** 敏感路径（密钥/凭证等）——这些文件即便"读"也拒绝，避免隐私上云。 */
const SENSITIVE_PATH =
  /(^|\/)\.(ssh|aws|gnupg)(\/|$)|id_rsa|id_ed25519|\.pem$|\.p12$|\.key$|credentials|secring|\.keychain/i

/** 解释器只允许"查版本"（否则可执行任意代码）。 */
const versionOnly = (args: string[]): boolean =>
  args.length === 1 && /^(--version|-v|-V|-version|version)$/.test(args[0])

/** 双用命令：只有满足条件的子命令/参数才算只读。 */
const GATED: Record<string, (args: string[]) => boolean> = {
  networksetup: (a) => /^-(get|list)/.test(a[0] ?? ''),
  pmset: (a) => a[0] === '-g',
  scutil: (a) => a.some((x) => x === '--dns' || x === '--proxy' || x === '--nwi'),
  top: (a) => a.includes('-l'),
  sysctl: (a) => !a.includes('-w'),
  // 解释器：仅查版本
  node: versionOnly,
  python: versionOnly,
  python3: versionOnly,
  ruby: versionOnly,
  php: versionOnly,
  perl: versionOnly,
  java: versionOnly,
  go: versionOnly,
  rustc: versionOnly,
  gcc: versionOnly,
  clang: versionOnly,
  swift: versionOnly,
  // 包管理器/版本控制：仅只读子命令
  git: (a) =>
    a.includes('--version') ||
    ['status', 'log', 'remote', 'branch', 'diff', 'show', 'rev-parse', 'describe', 'tag', 'ls-files', 'ls-remote', 'blame'].includes(a[0] ?? ''),
  npm: (a) => a.includes('--version') || a.includes('-v') || ['list', 'ls', 'view', 'why', 'outdated', 'info'].includes(a[0] ?? ''),
  pnpm: (a) => a.includes('--version') || ['list', 'ls', 'why', 'outdated', 'view'].includes(a[0] ?? ''),
  yarn: (a) => a.includes('--version') || ['list', 'why', 'outdated', 'info'].includes(a[0] ?? ''),
  brew: (a) => a.includes('--version') || ['list', 'info', 'config', 'outdated', 'doctor', 'deps'].includes(a[0] ?? ''),
  pip: (a) => a.includes('--version') || ['list', 'show', 'freeze'].includes(a[0] ?? ''),
  pip3: (a) => a.includes('--version') || ['list', 'show', 'freeze'].includes(a[0] ?? ''),
  defaults: (a) => ['read', 'read-type', 'domains', 'find'].includes(a[0] ?? '')
}

/** 明确禁止（即便像"读"也拒绝，避免隐蔽写/任意执行）。 */
const NEVER = new Set([
  'rm', 'rmdir', 'mv', 'cp', 'dd', 'mkfs', 'kill', 'killall', 'shutdown', 'reboot',
  'osascript', 'sudo', 'sh', 'bash', 'zsh', 'curl', 'wget', 'launchctl',
  'diskutil', 'tmutil', 'chmod', 'chown', 'ln', 'touch', 'env', 'printenv',
  'find', 'sed', 'awk', 'xargs', 'eval', 'exec'
])

/** 判断一条命令是否属于"可放行的只读诊断"。白名单制：未知一律拒绝。 */
export function isReadOnlyAllowed(command: string, args: string[]): AllowResult {
  if (NEVER.has(command)) {
    return { allowed: false, reason: `${command} 不是只读命令，请用专门的修复工具` }
  }
  if (FILE_READERS.has(command) && args.some((a) => SENSITIVE_PATH.test(a))) {
    return { allowed: false, reason: '涉及敏感文件（密钥/凭证等），出于隐私已拒绝' }
  }
  if (ALWAYS_READONLY.has(command)) return { allowed: true }
  if (command in GATED) {
    return GATED[command](args)
      ? { allowed: true }
      : { allowed: false, reason: `${command} ${args[0] ?? ''} 不是只读子命令` }
  }
  return { allowed: false, reason: `${command} 不在只读白名单内（只读诊断只允许已知安全命令）` }
}
