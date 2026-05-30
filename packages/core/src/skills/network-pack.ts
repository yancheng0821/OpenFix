import type { SkillPack } from './skill-pack.js'
import { createNetworkTools } from '../tools/network.js'
import { createNetworkDiagnosticTools } from '../tools/network-diagnostics.js'
import { createNetworkFixTools } from '../tools/network-fix.js'
import { createNetworkVerifyTools } from '../tools/network-verify.js'

/** 网络域技能包：只读诊断 + 可逆改 DNS + 复测。 */
export const networkSkillPack: SkillPack = {
  name: 'network',
  createTools: (ctx) => ({
    ...createNetworkTools(ctx.shell),
    ...createNetworkDiagnosticTools(ctx.shell),
    ...createNetworkFixTools({ shell: ctx.shell, changeLog: ctx.changeLog, confirm: ctx.confirm }),
    ...createNetworkVerifyTools(ctx.shell, ctx.verification)
  }),
  systemPrompt: `【网络域】只读诊断：check_connectivity（测连通）、resolve_dns（域名能否解析）、check_proxy（当前代理设置）、get_wifi_info（连的哪个 Wi-Fi）。可逆修复：set_dns_servers（改 DNS）。复测：verify_connectivity。任何修复后必须调用 verify_connectivity 复测，只有复测通过才算修好。`
}
