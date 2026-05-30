/** 一次运行的"修复后复测"结果；orchestrator 据此决定是否回滚。 */
export class Verification {
  private _passed: boolean | null = null

  /** 记录一次复测结果；以最后一次为准。 */
  record(passed: boolean): void {
    this._passed = passed
  }

  get passed(): boolean | null {
    return this._passed
  }

  get attempted(): boolean {
    return this._passed !== null
  }
}
