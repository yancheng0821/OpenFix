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
  empty_trash: { label: '清空废纸篓', risk: 'write' },
  verify_connectivity: { label: '复测连通性', risk: 'verify' }
}

/** 工具名 → 人类可读标签 + 风险类别（用于图标/配色）。 */
export function toolLabel(tool: string): { label: string; risk: Risk } {
  return LABELS[tool] ?? { label: tool, risk: 'read' }
}
