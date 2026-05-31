import { describe, it, expect } from 'vitest'
import { looksSensitive, composeMemoryInjection, applyMemory, SCAFFOLD } from './memory'

describe('looksSensitive', () => {
  it('密钥/密码/隐私路径判为敏感', () => {
    expect(looksSensitive('我的密码是 abc123')).toBe(true)
    expect(looksSensitive('api_key=sk-xxx')).toBe(true)
    expect(looksSensitive('看 ~/.ssh/id_rsa')).toBe(true)
  })
  it('普通机器事实不敏感', () => {
    expect(looksSensitive('活动网卡 en7=AX88179B')).toBe(false)
    expect(looksSensitive('装了 Homebrew')).toBe(false)
  })
})

describe('composeMemoryInjection', () => {
  it('空内容→空串（不注入）', () => {
    expect(composeMemoryInjection('')).toBe('')
    expect(composeMemoryInjection('   \n  ')).toBe('')
  })
  it('非空→带标头包裹', () => {
    const out = composeMemoryInjection('## 机器事实\n- en7=AX88179B')
    expect(out).toMatch(/关于这台机器/)
    expect(out).toMatch(/en7=AX88179B/)
    expect(out).toMatch(/remember/)
  })
})

describe('applyMemory', () => {
  it('空内容→用脚手架并写到对应分节', () => {
    const out = applyMemory('', { category: 'machine', note: '装了 Homebrew' })
    expect(out).not.toBeNull()
    const lines = (out as string).split('\n')
    const hi = lines.findIndex((l) => l.trim() === '## 机器事实')
    expect(lines[hi + 1].trim()).toBe('- 装了 Homebrew')
  })
  it('不同 category 落到不同分节', () => {
    let doc = applyMemory('', { category: 'preference', note: '偏好 DNS 8.8.8.8' }) as string
    doc = applyMemory(doc, { category: 'fix', note: '关过 AX88179B 代理' }) as string
    const idxPref = doc.indexOf('偏好 DNS 8.8.8.8')
    const idxFix = doc.indexOf('关过 AX88179B 代理')
    expect(doc.slice(0, idxPref)).toMatch(/## 偏好/)
    expect(doc.slice(0, idxFix)).toMatch(/## 过往修复/)
  })
  it('完全相同的条目→去重返回 null', () => {
    const doc = applyMemory('', { category: 'machine', note: '装了 Homebrew' }) as string
    expect(applyMemory(doc, { category: 'machine', note: '装了 Homebrew' })).toBeNull()
  })
  it('敏感内容→不写返回 null', () => {
    expect(applyMemory(SCAFFOLD, { category: 'machine', note: '密码 abc123' })).toBeNull()
  })
})
