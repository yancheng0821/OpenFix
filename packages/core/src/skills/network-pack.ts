import type { SkillPack } from './skill-pack.js'
import { createNetworkFixTools } from '../tools/network-fix.js'
import { createNetworkVerifyTools } from '../tools/network-verify.js'

/** 网络域技能包：诊断走通用 run_diagnostic，本包提供可逆修复 + 复测。 */
export const networkSkillPack: SkillPack = {
  name: 'network',
  createTools: (ctx) => ({
    ...createNetworkFixTools({ shell: ctx.shell, changeLog: ctx.changeLog, confirm: ctx.confirm }),
    ...createNetworkVerifyTools(ctx.shell, ctx.verification)
  }),
  systemPrompt: `【网络域】用 run_diagnostic 跑只读命令排查：ping <主机>、dig +short <域名>、scutil --dns、networksetup -getdnsservers Wi-Fi、networksetup -getwebproxy Wi-Fi、networksetup -getairportnetwork en0。可逆修复：set_dns_servers（改 DNS）。任何修复后必须调用 verify_connectivity 复测，只有复测通过才算修好。`
}
