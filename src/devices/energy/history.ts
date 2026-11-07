/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * energy/history.ts: daily kWh per appliance and a log of finished cycles,
 * kept in smarthq-energy-history.json for the settings-page dashboard.
 *
 * Days are local calendar dates (the Homebridge host's time zone), so "today"
 * on the dashboard matches the owner's day rather than UTC's.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

/** How long changes may sit unsaved. A crash loses at most this much history. */
export const HISTORY_SAVE_DELAY_MS = 5 * 60 * 1000
/** Days kept per appliance: a little over a year, for month-on-month views. */
export const HISTORY_MAX_DAYS = 400
/** Finished cycles kept, across all appliances, newest last. */
export const HISTORY_MAX_CYCLES = 300

export interface EnergyCycle {
  /** `${applianceId}:${model key}`, the same key as the saved totals. */
  key: string
  /** The appliance's name in HomeKit. */
  name: string
  /** The programme, when the appliance reports one (e.g. "Cottons"). */
  cycle?: string
  /** Epoch milliseconds. */
  start: number
  end: number
  kwh: number
  peakWatts: number
}

export interface EnergyHistoryData {
  version: 1
  /** key -> local date (YYYY-MM-DD) -> kWh used that day. */
  days: Record<string, Record<string, number>>
  cycles: EnergyCycle[]
}

/** A local calendar date as YYYY-MM-DD. */
export function localDay(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const emptyHistory = (): EnergyHistoryData => ({ version: 1, days: {}, cycles: [] })

/** Drop anything malformed, so a hand-edited or truncated file cannot break the plugin. */
export function sanitiseHistory(parsed: unknown): EnergyHistoryData {
  const out = emptyHistory()
  if (!parsed || typeof parsed !== 'object') {
    return out
  }
  const p = parsed as Record<string, any>
  if (p.days && typeof p.days === 'object') {
    for (const [key, days] of Object.entries(p.days)) {
      if (!days || typeof days !== 'object') {
        continue
      }
      for (const [day, kwh] of Object.entries(days as Record<string, unknown>)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof kwh === 'number' && Number.isFinite(kwh) && kwh >= 0) {
          (out.days[key] ??= {})[day] = kwh
        }
      }
    }
  }
  if (Array.isArray(p.cycles)) {
    for (const c of p.cycles) {
      if (c && typeof c.key === 'string' && typeof c.name === 'string'
        && [c.start, c.end, c.kwh, c.peakWatts].every(n => typeof n === 'number' && Number.isFinite(n))) {
        out.cycles.push({
          key: c.key,
          name: c.name,
          ...(typeof c.cycle === 'string'
            ? { cycle: c.cycle }
            : {}),
          start: c.start,
          end: c.end,
          kwh: c.kwh,
          peakWatts: c.peakWatts,
        })
      }
    }
  }
  return out
}

export class EnergyHistory {
  private data: EnergyHistoryData = emptyHistory()
  private saveTimer?: ReturnType<typeof setTimeout>

  constructor(private readonly path?: string, private readonly onError: (message: string) => void = () => {}) {
    if (!path) {
      return
    }
    try {
      this.data = sanitiseHistory(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        onError(`Could not read energy history (${error?.message ?? error}); starting a new one`)
      }
    }
  }

  /** Credit energy to an appliance's day. Negative or non-finite amounts are ignored. */
  addEnergy(key: string, kwh: number, nowMs = Date.now()): void {
    if (!(kwh > 0) || !Number.isFinite(kwh)) {
      return
    }
    const days = (this.data.days[key] ??= {})
    const day = localDay(nowMs)
    days[day] = (days[day] ?? 0) + kwh
    const keys = Object.keys(days)
    if (keys.length > HISTORY_MAX_DAYS) {
      for (const old of keys.sort().slice(0, keys.length - HISTORY_MAX_DAYS)) {
        delete days[old]
      }
    }
    this.scheduleSave()
  }

  addCycle(cycle: EnergyCycle): void {
    this.data.cycles.push(cycle)
    if (this.data.cycles.length > HISTORY_MAX_CYCLES) {
      this.data.cycles.splice(0, this.data.cycles.length - HISTORY_MAX_CYCLES)
    }
    this.scheduleSave()
  }

  /** A copy, so callers cannot change the stored history by accident. */
  snapshot(): EnergyHistoryData {
    return JSON.parse(JSON.stringify(this.data))
  }

  private scheduleSave(): void {
    if (this.path && !this.saveTimer) {
      const timer: any = setTimeout(() => this.flush(), HISTORY_SAVE_DELAY_MS)
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
      writeFileSync(tmp, JSON.stringify(this.data))
      renameSync(tmp, this.path)
    } catch (error: any) {
      this.onError(`Could not save energy history: ${error?.message ?? error}`)
    }
  }
}
