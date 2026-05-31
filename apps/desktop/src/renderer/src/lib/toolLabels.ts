export type Risk = 'read' | 'write' | 'verify'

const LABELS: Record<string, { label: string; risk: Risk }> = {
  run_diagnostic: { label: '运行诊断命令', risk: 'read' },
  check_connectivity: { label: '测试连通性', risk: 'read' },
  resolve_dns: { label: '解析域名', risk: 'read' },
  check_proxy: { label: '检查代理设置', risk: 'read' },
  get_wifi_info: { label: '查看 Wi-Fi', risk: 'read' },
  check_disk_space: { label: '查看磁盘空间', risk: 'read' },
  check_app_installed: { label: '检查软件安装', risk: 'read' },
  set_dns_servers: { label: '修改 DNS', risk: 'write' },
  clear_proxy: { label: '关闭代理', risk: 'write' },
  restart_wifi: { label: '重启 Wi-Fi', risk: 'write' },
  empty_trash: { label: '清空废纸篓', risk: 'write' },
  kill_process: { label: '结束进程', risk: 'write' },
  restart_finder: { label: '重启访达', risk: 'write' },
  restart_dock: { label: '重启程序坞', risk: 'write' },
  open_app: { label: '打开应用', risk: 'read' },
  open_url: { label: '打开网址', risk: 'read' },
  remember: { label: '记住', risk: 'read' },
  propose_fix: { label: '执行修复', risk: 'write' },
  verify_connectivity: { label: '复测连通性', risk: 'verify' }
}

/** 工具名 → 人类可读标签 + 风险类别（用于图标/配色）。 */
export function toolLabel(tool: string): { label: string; risk: Risk } {
  return LABELS[tool] ?? { label: tool, risk: 'read' }
}

/** 把工具结果压成一行 mono 技术值（时间线右侧展示，强化"深挖可信度"）。 */
export function formatDetail(tool: string, output: unknown): string {
  const o = (output ?? {}) as Record<string, unknown>
  if (typeof o !== 'object') return ''
  switch (tool) {
    case 'check_connectivity':
      return o.reachable ? `通 · ${o.latencyMs ?? '?'}ms` : '不通'
    case 'resolve_dns':
      return o.resolved ? String((o.addresses as string[] | undefined)?.[0] ?? '已解析') : '解析失败'
    case 'check_proxy':
      return o.enabled ? `代理 ${o.server}:${o.port}` : '无代理'
    case 'get_wifi_info':
      return o.connected ? String(o.ssid) : '未连 Wi-Fi'
    case 'check_disk_space':
      return o.available ? `剩 ${o.available}` : ''
    case 'check_app_installed':
      return o.installed ? '已安装' : '未安装'
    case 'set_dns_servers':
      return '已改 DNS'
    case 'verify_connectivity':
      return o.reachable ? '通过' : '未通过'
    case 'run_diagnostic':
      return String((o.command as string | undefined) ?? (o.refused ? '已拒绝' : ''))
    default:
      return ''
  }
}
