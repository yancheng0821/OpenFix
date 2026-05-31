import { describe, it, expect } from 'vitest'
import { systemSkillPack } from './system-pack'
import { ChangeLog } from '../safety/change-log'
import { Verification } from '../safety/verification'

describe('systemSkillPack', () => {
  it('提供 check_disk_space / check_app_installed 两个工具', () => {
    const tools = systemSkillPack.createTools({
      shell: async () => ({ code: 0, stdout: '', stderr: '' }),
      changeLog: new ChangeLog(),
      verification: new Verification()
    })
    expect(Object.keys(tools).sort()).toEqual([
      'empty_trash',
      'kill_process',
      'restart_dock',
      'restart_finder'
    ])
  })
})
