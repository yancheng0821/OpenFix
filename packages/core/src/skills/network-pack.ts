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
  systemPrompt: `【网络域】可逆修复工具：set_dns_servers（改 DNS）、clear_proxy（关代理）、restart_wifi（重启 Wi-Fi）。调用时 **service 留空即可**——工具会自动作用于当前活动网卡；不要假设用户走的是 Wi-Fi（可能是以太网/USB 网卡）。
排查先用 run_diagnostic 把现象查清楚（走哪张网卡、能不能 ping 通、域名解析成什么、有没有代理），再判断——不要只看到一个值就下结论。
原则：**先查清根因再动手**。若根因是用户自己装的代理/VPN/安全软件在按其设计工作（不是系统故障），不要用系统级改动去对抗它——直接把情况讲清楚交给用户决定，比偷偷改系统设置更安全也更可信。
任何修复后必须调用 verify_connectivity 复测（它会真发一个 HTTP 请求确认能不能上网，比 ping 可信）；只有复测通过才算修好，没通过会自动还原本次改动。`
}
