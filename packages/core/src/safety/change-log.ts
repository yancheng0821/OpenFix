export type RiskLevel = 'reversible' | 'irreversible' | 'safe'

export interface ChangeEntry {
  id: number
  description: string
  riskLevel: RiskLevel
  rollback: () => Promise<void>
  /**
   * 是否参与"失败自动还原"安全网（自动应用的网络修复=true；用户确认的 propose_fix=false）。
   * 省略视为 true。false 的改动只能手动一键还原，不会被"没复测"误回滚。
   */
  autoRevert?: boolean
}

export interface ChangeSummary {
  id: number
  description: string
  riskLevel: RiskLevel
}

/** 一次运行中所有写操作的账本：记录改动并支持按 LIFO 回滚。 */
export class ChangeLog {
  private entries: ChangeEntry[] = []
  private nextId = 1

  record(entry: Omit<ChangeEntry, 'id'>): number {
    const id = this.nextId++
    this.entries.push({ id, ...entry })
    return id
  }

  list(): ChangeSummary[] {
    return this.entries.map(({ id, description, riskLevel }) => ({ id, description, riskLevel }))
  }

  async rollbackAll(): Promise<void> {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      await this.entries[i].rollback()
    }
    this.entries = []
  }

  /** 只回滚"可逆"改动（LIFO），并移除它们；不可逆记录保留（无法撤销）。供手动"一键还原"。 */
  async rollbackReversible(): Promise<void> {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].riskLevel === 'reversible') await this.entries[i].rollback()
    }
    this.entries = this.entries.filter((e) => e.riskLevel !== 'reversible')
  }

  /**
   * 失败自动还原安全网：只回滚"自动应用且需复测"的可逆改动（autoRevert!==false），
   * 保留用户确认型(propose_fix, autoRevert===false)的改动。返回是否回滚了任何项。
   */
  async rollbackAutoRevert(): Promise<boolean> {
    const isAuto = (e: ChangeEntry): boolean =>
      e.riskLevel === 'reversible' && e.autoRevert !== false
    let did = false
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (isAuto(this.entries[i])) {
        await this.entries[i].rollback()
        did = true
      }
    }
    this.entries = this.entries.filter((e) => !isAuto(e))
    return did
  }
}
