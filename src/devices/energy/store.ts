/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * energy/store.ts: the running kWh totals, kept in their own file.
 *
 * ⚠️ Not in accessory.context: the platform rebuilds the context from the API
 * on every launch (`accessory.context = { device, userId }`), so anything
 * stored there is lost at each restart and every total would start from zero.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

/** How long changes may sit unsaved. Totals move slowly; a crash loses at most this. */
export const ENERGY_SAVE_DELAY_MS = 5 * 60 * 1000

export class EnergyStore {
  private totals: Record<string, number> = {}
  private saveTimer?: ReturnType<typeof setTimeout>

  constructor(private readonly path?: string, private readonly onError: (message: string) => void = () => {}) {
    if (!path) {
      return
    }
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
            this.totals[key] = value
          }
        }
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        onError(`Could not read saved energy totals (${error?.message ?? error}); starting from zero`)
      }
    }
  }

  get(key: string): number {
    return this.totals[key] ?? 0
  }

  set(key: string, kwh: number): void {
    this.totals[key] = kwh
    if (this.path && !this.saveTimer) {
      const timer: any = setTimeout(() => this.flush(), ENERGY_SAVE_DELAY_MS)
      timer.unref?.() // never keep Homebridge alive just to save
      this.saveTimer = timer
    }
  }

  /** Write now. Atomic, so a crash mid-write cannot leave a half file. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
    if (!this.path) {
      return
    }
    try {
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify(this.totals, null, 2))
      renameSync(tmp, this.path)
    } catch (error: any) {
      this.onError(`Could not save energy totals: ${error?.message ?? error}`)
    }
  }
}
