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
  systemPrompt: `【网络域】排查顺序：
1) **先确定当前活动网卡**：run_diagnostic 跑 route -n get default 看走的是哪张网卡（en0/en7…），再用 networksetup -listnetworkserviceorder 把它对应到服务名（如 Wi-Fi / USB 10/100/1000 LAN）。**用户不一定走 Wi-Fi，可能是以太网**——不要默认 Wi-Fi。
2) 再排查：ping <主机>、dig +short <域名>、scutil --dns、networksetup -getdnsservers <服务名>、networksetup -getwebproxy <服务名>。
可逆修复工具：set_dns_servers（改 DNS）、clear_proxy（关闭挡路的代理）、restart_wifi（重启 Wi-Fi）。**调用时 service 留空即可，工具会自动作用于当前活动网卡**；不要写死 Wi-Fi。
**认识 fake-ip**：域名被解析到 198.18.x.x / 198.19.x.x / 100.64.x.x / 0.0.0.0 这类地址，通常是代理软件（Clash/Surge/Stash）的 fake-ip 机制，是**正常**的，不是 DNS 故障。此时若上不了网，多半是代理节点/订阅失效——应提示用户检查或退出该代理软件，**不要去乱改系统 DNS**（改了也会被代理劫持，反而帮倒忙）。
任何修复后必须调用 verify_connectivity 复测（它会真发一个 HTTP 请求确认能不能上网，比 ping 可信）；只有复测通过才算修好，没通过会自动还原本次改动。`
}
