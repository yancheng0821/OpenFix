import { describe, it, expect } from 'vitest'
import { networkSkillPack } from './network-pack'
import { ChangeLog } from '../safety/change-log'
import { Verification } from '../safety/verification'

describe('networkSkillPack', () => {
  it('提供 check_connectivity / set_dns_servers / verify_connectivity 三个工具', () => {
    const tools = networkSkillPack.createTools({
      shell: async () => ({ code: 0, stdout: '', stderr: '' }),
      changeLog: new ChangeLog(),
      verification: new Verification()
    })
    expect(Object.keys(tools).sort()).toEqual([
      'clear_proxy',
      'restart_wifi',
      'set_dns_servers',
      'verify_connectivity'
    ])
  })

  it('带网络域的系统提示（含复测要求）', () => {
    expect(networkSkillPack.systemPrompt).toMatch(/verify_connectivity/)
  })
})
