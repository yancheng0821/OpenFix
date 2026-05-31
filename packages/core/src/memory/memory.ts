/** 记忆分类：machine=机器事实，preference=用户偏好，fix=过往修复。 */
export type MemoryCategory = 'machine' | 'preference' | 'fix'

export interface MemoryEntry {
  category: MemoryCategory
  note: string
}

const SECTION: Record<MemoryCategory, string> = {
  machine: '## 机器事实',
  preference: '## 偏好',
  fix: '## 过往修复'
}

/** 空记忆文件的脚手架。 */
export const SCAFFOLD = `# OpenFix 记忆（自动维护，可手动编辑/删除）

## 机器事实

## 偏好

## 过往修复
`

/** 敏感内容守卫：命中即不入记忆（避免密钥/账号/隐私路径上云）。 */
const SENSITIVE =
  /password|passwd|密码|secret|token|api[_-]?key|apikey|private key|私钥|助记词|seed phrase|\.ssh|\.aws|\.gnupg|id_rsa|id_ed25519|\.pem|\.p12|\.key\b|credentials|keychain/i

export function looksSensitive(note: string): boolean {
  return SENSITIVE.test(note)
}

/** 把记忆内容包成注入 system 的片段；空内容返回空串（不注入）。 */
export function composeMemoryInjection(content: string): string {
  const c = content.trim()
  if (!c) return ''
  return `【关于这台机器和用户（你之前记下的）】\n${c}\n（若其中某条已过时/与实际不符，以实际为准，并用 remember 更新。）`
}

/** 在指定分节标题下插入一行。找不到分节则追加到文末新建该分节。 */
function insertUnderSection(content: string, header: string, line: string): string {
  const lines = content.split('\n')
  const idx = lines.findIndex((l) => l.trim() === header)
  if (idx === -1) return `${content.replace(/\s*$/, '')}\n\n${header}\n${line}\n`
  lines.splice(idx + 1, 0, line)
  return lines.join('\n')
}

/**
 * 纯函数：把一条记忆并入现有内容。
 * 敏感或与现有条目完全重复 → 返回 null（不写）。空内容用脚手架。
 */
export function applyMemory(current: string, entry: MemoryEntry): string | null {
  if (looksSensitive(entry.note)) return null
  const header = SECTION[entry.category] ?? SECTION.machine
  const base = current.trim() ? current : SCAFFOLD
  const line = `- ${entry.note.trim()}`
  if (base.split('\n').some((l) => l.trim() === line)) return null
  return insertUnderSection(base, header, line)
}
