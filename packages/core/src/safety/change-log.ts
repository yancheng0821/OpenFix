export type RiskLevel = 'reversible' | 'irreversible'

export interface ChangeEntry {
  id: number
  description: string
  riskLevel: RiskLevel
  rollback: () => Promise<void>
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
}
