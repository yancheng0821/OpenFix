import { describe, it, expect } from 'vitest'
import { tool } from 'ai'
import { z } from 'zod'
import { composeTools, composeSystemPrompts, type SkillPack, type SkillContext } from './skill-pack'
import { ChangeLog } from '../safety/change-log'
import { Verification } from '../safety/verification'

const ctx: SkillContext = {
  shell: async () => ({ code: 0, stdout: '', stderr: '' }),
  changeLog: new ChangeLog(),
  verification: new Verification()
}

function fakePack(name: string, toolName: string, prompt?: string): SkillPack {
  return {
    name,
    createTools: () => ({
      [toolName]: tool({ description: name, inputSchema: z.object({}), execute: async () => 'ok' })
    }),
    systemPrompt: prompt
  }
}

describe('skill-pack', () => {
  it('composeTools 合并各包工具', () => {
    const tools = composeTools([fakePack('a', 'tool_a'), fakePack('b', 'tool_b')], ctx)
    expect(Object.keys(tools).sort()).toEqual(['tool_a', 'tool_b'])
  })

  it('composeSystemPrompts 只拼接非空片段，用空行分隔', () => {
    const s = composeSystemPrompts([
      fakePack('a', 't_a', 'AAA'),
      fakePack('b', 't_b'),
      fakePack('c', 't_c', 'CCC')
    ])
    expect(s).toBe('AAA\n\nCCC')
  })
})
