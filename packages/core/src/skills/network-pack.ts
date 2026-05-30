import type { SkillPack } from './skill-pack.js'
import { createNetworkTools } from '../tools/network.js'
import { createNetworkFixTools } from '../tools/network-fix.js'
import { createNetworkVerifyTools } from '../tools/network-verify.js'

/** 网络域技能包：只读诊断 + 可逆改 DNS + 复测。 */
export const networkSkillPack: SkillPack = {
  name: 'network',
  createTools: (ctx) => ({
    ...createNetworkTools(ctx.shell),
    ...createNetworkFixTools({ shell: ctx.shell, changeLog: ctx.changeLog, confirm: ctx.confirm }),
    ...createNetworkVerifyTools(ctx.shell, ctx.verification)
  }),
  systemPrompt: `【网络域】工具：check_connectivity（只读测连通）、set_dns_servers（可逆改 DNS）、verify_connectivity（修复后复测）。任何修复后必须调用 verify_connectivity 复测，只有复测通过才算修好。`
}
