/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * energy/monitor.ts: publishes an appliance's ESTIMATED power and energy.
 *
 * The estimate comes from the appliance's EnergyModel (models.ts). This file
 * turns it into kWh over time and publishes both on one tile, over one of two
 * protocols (energyProtocol):
 *  - matter: an OnOffOutlet with the ElectricalPowerMeasurement and
 *    ElectricalEnergyMeasurement clusters, for every appliance. Always-on
 *    appliances (fridge, filter) are outlets that stay On: outlets are what
 *    Apple Home's energy view is known to read, while its support for the
 *    Matter ElectricalSensor device type is unconfirmed. Apple Home on iOS/iPadOS 27+ shows
 *    the watts on the tile and in the Home app's Energy view. Needs Homebridge
 *    2.2.1+ with Matter enabled on the bridge; falls back to HAP otherwise.
 *  - hap (default): an Outlet carrying Eve's Consumption (W) and Total
 *    Consumption (kWh). Apple Home shows On/Off; Eve, Controller for HomeKit
 *    and Home+ show the watts and kWh. Optionally a linked light sensor mirrors
 *    the watts as lux, since HAP has no power reading Apple Home displays.
 */
import type { CharacteristicValue, HAP, Characteristic as HapCharacteristic, PlatformAccessory, Service, WithUUID } from 'homebridge'

import type { EnergyHistory } from './history.js'
import type { EnergyModel, EnergyProfile, EnergyReading } from './models.js'
import type { EnergyStore } from './store.js'

import { ERD_TYPES } from '../../settings.js'
import { resolveProfile } from './models.js'

export type EnergyProtocol = 'hap' | 'matter'

export function resolveEnergyProtocol(device: Record<string, unknown>): EnergyProtocol {
  return device.energyProtocol === 'matter'
    ? 'matter'
    : 'hap'
}

/** Longest gap integrated in one step, so a stalled clock cannot add a huge lump. */
export const MAX_INTEGRATION_GAP_MS = 60 * 60 * 1000

/**
 * Integrates watts over time into kWh. Each update credits the PREVIOUS
 * wattage for the time since the last update, then switches to the new one.
 */
export class EnergyMeter {
  watts = 0
  totalKwh: number
  cycleKwh = 0
  private lastMs: number

  constructor(totalKwh = 0, nowMs = Date.now()) {
    this.totalKwh = totalKwh
    this.lastMs = nowMs
  }

  update(watts: number, nowMs = Date.now()): void {
    const elapsed = Math.min(Math.max(nowMs - this.lastMs, 0), MAX_INTEGRATION_GAP_MS)
    const kwh = (this.watts * elapsed) / 3_600_000_000
    this.totalKwh += kwh
    this.cycleKwh += kwh
    this.watts = watts
    this.lastMs = nowMs
  }
}

// --- Eve characteristics ----------------------------------------------------

export const EVE_CONSUMPTION_UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52'
export const EVE_TOTAL_CONSUMPTION_UUID = 'E863F10C-079E-48FF-8F27-9C2605A29F52'

/** Usable both with addCharacteristic and with get/updateCharacteristic. */
type EveCharacteristic = WithUUID<typeof HapCharacteristic> & WithUUID<new () => HapCharacteristic>
interface EveCharacteristics {
  Consumption: EveCharacteristic
  TotalConsumption: EveCharacteristic
}
const eveCache = new WeakMap<HAP, EveCharacteristics>()

/**
 * Eve's power characteristics, created once per HAP instance so every
 * accessory shares the same classes (HAP matches characteristics by UUID).
 */
export function eveCharacteristics(hap: HAP): EveCharacteristics {
  const cached = eveCache.get(hap)
  if (cached) {
    return cached
  }
  const { Characteristic, Formats, Perms } = hap
  class Consumption extends Characteristic {
    static readonly UUID = EVE_CONSUMPTION_UUID
    constructor() {
      super('Consumption', EVE_CONSUMPTION_UUID, {
        format: Formats.FLOAT,
        unit: 'W',
        minValue: 0,
        maxValue: 100000,
        minStep: 0.1,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
      })
      this.value = this.getDefaultValue()
    }
  }
  class TotalConsumption extends Characteristic {
    static readonly UUID = EVE_TOTAL_CONSUMPTION_UUID
    constructor() {
      super('Total Consumption', EVE_TOTAL_CONSUMPTION_UUID, {
        format: Formats.FLOAT,
        unit: 'kWh',
        minValue: 0,
        maxValue: 1000000000,
        minStep: 0.001,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
      })
      this.value = this.getDefaultValue()
    }
  }
  const result = { Consumption, TotalConsumption } as unknown as EveCharacteristics
  eveCache.set(hap, result)
  return result
}

// --- monitor ----------------------------------------------------------------

/** What the monitor needs from the appliance it measures. */
export interface EnergyHost {
  hap: HAP
  accessory: PlatformAccessory<any>
  /** Merged device config (showEnergy, energyProtocol, wattage overrides). */
  device: Record<string, any>
  applianceId: string
  refreshRateSeconds: number
  readErd: (erd: string) => Promise<string | undefined>
  store: EnergyStore
  /** Daily kWh and finished cycles, for the settings-page dashboard. */
  history?: EnergyHistory
  /** The appliance's name in HomeKit, shown on the dashboard. */
  name?: string
  infoLog: (...log: any[]) => unknown
  debugLog: (...log: any[]) => unknown
  warnLog: (...log: any[]) => unknown
  /** Homebridge's api.matter, when present. Only used with energyProtocol 'matter'. */
  matterApi?: any
  /** For models not driven by ERDs (the v2 smoker). */
  externalActive?: () => boolean
}

/** One appliance's live state, as written to smarthq-energy-status.json. */
export interface EnergyStatus {
  key: string
  applianceId: string
  name: string
  tileName: string
  model: string
  label: string
  /** What the owner chose, and what is actually in use after any fallback. */
  protocolWanted: EnergyProtocol
  protocol: EnergyProtocol
  fallbackReason?: string
  matterRegistered: boolean
  watts: number
  active: boolean
  description?: string
  totalKwh: number
  /** The cycle in progress, if any. */
  cycle?: { name?: string, start: number, kwh: number, peakWatts: number }
  fixed: boolean
  alwaysOn: boolean
  profile: EnergyProfile
  defaults: EnergyProfile
  /** The appliance readings the estimate uses. */
  erds: Record<string, string>
  /** When a reading last arrived (push or poll), epoch ms. */
  lastValueAt?: number
  /** Readings that may be real power data, not decoded yet. */
  rawPowerErds: Record<string, string>
  startedAt: number
}

/** Names and subtypes the model's tile uses. */
export function energyIds(model: EnergyModel) {
  const compact = model.label.replace(/[^a-z0-9]/gi, '')
  return {
    tileName: model.tileName ?? `${model.label} Energy`,
    subtype: model.subtype ?? `${compact}Energy`,
    powerName: `${model.label} Power`,
    powerSubtype: `${compact}Power`,
  }
}

/** Remove the HAP energy services, for when the option is off or Matter is used. */
export function removeEnergyServices(accessory: PlatformAccessory, hap: HAP, model: EnergyModel): void {
  const { subtype, powerSubtype } = energyIds(model)
  for (const [type, sub] of [
    [hap.Service.Outlet, subtype],
    [hap.Service.LightSensor, powerSubtype],
  ] as const) {
    const service = accessory.getServiceById(type, sub)
    if (service) {
      accessory.removeService(service)
    }
  }
}

/** How often the kWh total is advanced and the tile refreshed. Reads no ERDs. */
export const INTEGRATION_TICK_MS = 30_000
/**
 * Matter energy readings are pushed to every controller as events and are not
 * throttled, so Homebridge asks for a 30-60 s cadence. Power is throttled by
 * matter.js itself and can be sent on every change.
 */
export const MATTER_ENERGY_INTERVAL_MS = 60_000
const MATTER_REGISTER_ATTEMPTS = 6
const MATTER_REGISTER_RETRY_MS = 10_000

const PLUGIN_IDENTIFIER = '@homebridge-plugins/homebridge-smarthq'
const PLATFORM_NAME = 'SmartHQ'

/** Matter units: power in milliwatts, energy in milliwatt-hours, both integers. */
export const toMilliwatts = (watts: number): number => Math.round(watts * 1000)
export const toMilliwattHours = (kwh: number): number => Math.round(kwh * 1_000_000)

const round3 = (n: number): number => Math.round(n * 1000) / 1000
/** HomeKit's light level minimum is 0.0001 lux; 0 W would be rejected. */
const toLux = (watts: number): number => Math.min(Math.max(watts, 0.0001), 100000)

export class EnergyMonitor {
  outlet?: Service
  powerSensor?: Service
  readonly profile: EnergyProfile
  /** The protocol actually in use: 'matter' falls back to 'hap' if Matter is unavailable. */
  protocol: EnergyProtocol
  matterUuid?: string
  matterRegistered = false
  private readonly meter: EnergyMeter
  private readonly values = new Map<string, string>()
  private readonly watched: Set<string>
  private current: EnergyReading
  private wasActive = false
  private tickTimer?: ReturnType<typeof setInterval>
  private refreshTimer?: ReturnType<typeof setInterval>
  private snapTimer?: ReturnType<typeof setTimeout>
  private matterRetryTimer?: ReturnType<typeof setTimeout>
  private lastMatterEnergyMs = Number.NEGATIVE_INFINITY
  private lastMatter: { onOff?: boolean, activePower?: number, energy?: number } = {}
  private stopped = false
  private fallbackReason?: string
  private lastValueAt?: number
  private readonly rawPowerErds: Record<string, string> = {}
  private cycleStart?: number
  private cycleName?: string
  private cyclePeak = 0
  private readonly startedAt = Date.now()
  private readonly eve: EveCharacteristics
  private readonly storeKey: string

  constructor(private readonly host: EnergyHost, readonly model: EnergyModel) {
    this.profile = resolveProfile(model.defaults, host.device)
    this.protocol = resolveEnergyProtocol(host.device)
    this.eve = eveCharacteristics(host.hap)
    this.storeKey = `${host.applianceId}:${model.key}`
    this.meter = new EnergyMeter(host.store.get(this.storeKey))
    this.watched = new Set(model.erds.map(e => e.toLowerCase()))
    // Always-on appliances start On: the Matter tile registers before the first
    // reading arrives, and a fridge should never flash Off
    this.current = { watts: 0, active: model.alwaysOn === true }

    if (this.protocol === 'matter') {
      // The Matter tile replaces the HAP one; leaving either would show the
      // appliance twice in Apple Home
      removeEnergyServices(host.accessory, host.hap, model)
      this.removeReplacedSwitch()
      void this.registerMatter(1)
    } else {
      this.setupHap()
    }

    const p = this.profile
    host.infoLog(`Estimated energy enabled over ${this.protocol === 'matter'
      ? 'Matter'
      : 'HAP'}${model.fixed ? ' (fixed average - this appliance reports no usable state yet)' : ''} `
      + `(standby ${p.standbyWatts} W, motor ${p.motorWatts} W, ${model.key === 'washer' || model.key === 'washerDryer'
        ? `spin ${p.spinWatts} W, `
        : ''}heater ${p.heaterWatts} W)`)

    void this.refresh()
    this.tickTimer = setInterval(() => this.tick(), INTEGRATION_TICK_MS)
    // Guarded: a NaN delay makes Node fire the timer every millisecond
    const refreshSeconds = Number.isFinite(host.refreshRateSeconds)
      ? Math.max(host.refreshRateSeconds, 30)
      : 360
    if (model.erds.length > 0) {
      this.refreshTimer = setInterval(() => void this.refresh(), refreshSeconds * 1000)
    }
    void this.logRawPowerErd()
  }

  get watts(): number {
    return this.meter.watts
  }

  get totalKwh(): number {
    return this.meter.totalKwh
  }

  get active(): boolean {
    return this.current.active
  }

  private removeReplacedSwitch(): void {
    if (!this.model.replacesSwitch) {
      return
    }
    const old = this.host.accessory.getServiceById(this.host.hap.Service.Switch, this.model.replacesSwitch)
    if (old) {
      this.host.accessory.removeService(old)
    }
  }

  private setServiceName(service: Service, name: string): void {
    const { Characteristic } = this.host.hap
    service.setCharacteristic(Characteristic.Name, name)
    if (!service.testCharacteristic(Characteristic.ConfiguredName)) {
      service.addOptionalCharacteristic(Characteristic.ConfiguredName)
    }
    service.setCharacteristic(Characteristic.ConfiguredName, name)
  }

  // --- HAP ------------------------------------------------------------------

  private setupHap(): void {
    const { hap, accessory, device } = this.host
    const { Service, Characteristic } = hap
    const { tileName, subtype, powerName, powerSubtype } = energyIds(this.model)

    this.removeReplacedSwitch()
    const outlet = accessory.getServiceById(Service.Outlet, subtype) ?? accessory.addService(Service.Outlet, tileName, subtype)
    this.setServiceName(outlet, tileName)
    this.outlet = outlet

    outlet.getCharacteristic(Characteristic.On)
      .onGet(() => this.current.active)
      .onSet(() => {
        // Read-only: snap the tile back to the appliance's real state
        setTimeout(() => outlet.updateCharacteristic(Characteristic.On, this.current.active), 1000)
      })
    outlet.getCharacteristic(Characteristic.OutletInUse).onGet(() => this.current.active)

    if (!outlet.testCharacteristic(this.eve.Consumption)) {
      outlet.addCharacteristic(this.eve.Consumption)
    }
    if (!outlet.testCharacteristic(this.eve.TotalConsumption)) {
      outlet.addCharacteristic(this.eve.TotalConsumption)
    }
    outlet.getCharacteristic(this.eve.Consumption).onGet(() => this.meter.watts)
    outlet.getCharacteristic(this.eve.TotalConsumption).onGet(() => round3(this.meter.totalKwh))

    const existingSensor = accessory.getServiceById(Service.LightSensor, powerSubtype)
    if (device.showEnergyInHome) {
      const sensor = existingSensor ?? accessory.addService(Service.LightSensor, powerName, powerSubtype)
      this.setServiceName(sensor, powerName)
      sensor.getCharacteristic(Characteristic.CurrentAmbientLightLevel).onGet(() => toLux(this.meter.watts))
      // Grouped with the outlet, so with "Show as Single Tile" the Home app
      // opens straight from the tile to the power reading
      outlet.setPrimaryService(true)
      outlet.addLinkedService(sensor)
      this.powerSensor = sensor
    } else if (existingSensor) {
      accessory.removeService(existingSensor)
    }
  }

  private pushHap(): void {
    if (!this.outlet) {
      return
    }
    const { Characteristic } = this.host.hap
    this.outlet.updateCharacteristic(Characteristic.On, this.current.active)
    this.outlet.updateCharacteristic(Characteristic.OutletInUse, this.current.active)
    this.outlet.updateCharacteristic(this.eve.Consumption, this.meter.watts as CharacteristicValue)
    this.outlet.updateCharacteristic(this.eve.TotalConsumption, round3(this.meter.totalKwh))
    this.powerSensor?.updateCharacteristic(Characteristic.CurrentAmbientLightLevel, toLux(this.meter.watts))
  }

  // --- Matter ---------------------------------------------------------------

  /** Fall back to the HAP outlet so the tile is never silently missing. */
  private fallBackToHap(reason: string): void {
    this.fallbackReason = reason
    this.host.warnLog(`Matter energy tile unavailable (${reason}) - publishing it over HAP instead. `
      + 'Enable Matter for this bridge in Homebridge (2.2.1 or later) to use the Apple Home energy view.')
    this.protocol = 'hap'
    this.setupHap()
    this.pushHap()
  }

  /** The Matter accessory for this appliance's energy tile. */
  buildMatterAccessory(matterApi: any): Record<string, any> {
    const d = (this.host.accessory.context?.device ?? {}) as Record<string, any>
    const { tileName } = energyIds(this.model)
    // A UUID of its own, so it never collides with the appliance's other
    // accessories (or its own full Matter accessory) on the same bridge
    this.matterUuid = matterApi.uuid.generate(`${this.host.applianceId}-${this.model.key.toLowerCase()}-energy`)
    const clusters: Record<string, any> = {
      // Declaring these makes Homebridge add PowerTopology +
      // ElectricalPowerMeasurement (AC) + ElectricalEnergyMeasurement
      // (imported, cumulative) to the endpoint
      electricalPowerMeasurement: {
        activePower: toMilliwatts(this.meter.watts),
      },
      electricalEnergyMeasurement: {
        cumulativeEnergyImported: {
          energy: toMilliwattHours(this.meter.totalKwh),
        },
      },
    }
    const accessory: Record<string, any> = {
      UUID: this.matterUuid,
      displayName: tileName,
      serialNumber: `${this.host.applianceId}-${this.model.key}`.slice(-32), // Matter's limit is 32 characters
      manufacturer: d.brand && d.brand !== 'Unknown'
        ? d.brand
        : 'GE Appliances',
      model: d.model || 'SmartHQ',
      firmwareRevision: d.firmware || '1.0.0',
      hardwareRevision: d.firmware || '1.0.0',
      deviceType: matterApi.deviceTypes.OnOffOutlet,
      clusters,
      handlers: {},
    }
    clusters.onOff = { onOff: this.current.active }
    const snapBack = async (): Promise<void> => {
      // Read-only: the tile cannot start or stop the appliance
      if (this.snapTimer) {
        clearTimeout(this.snapTimer)
      }
      this.snapTimer = setTimeout(() => {
        this.lastMatter.onOff = undefined
        this.pushMatter(true)
      }, 1000)
    }
    accessory.handlers = {
      onOff: { on: snapBack, off: snapBack, toggle: snapBack },
    }
    return accessory
  }

  private async registerMatter(attempt: number): Promise<void> {
    if (this.stopped) {
      return
    }
    const matterApi = this.host.matterApi
    if (!matterApi || typeof matterApi.registerPlatformAccessories !== 'function' || !matterApi.uuid) {
      this.fallBackToHap('Homebridge has no Matter API')
      return
    }
    if (!matterApi.deviceTypes?.OnOffOutlet) {
      this.fallBackToHap('this Homebridge version has no Matter outlet device type')
      return
    }
    try {
      await matterApi.registerPlatformAccessories(PLUGIN_IDENTIFIER, PLATFORM_NAME, [
        this.buildMatterAccessory(matterApi),
      ])
      this.matterRegistered = true
      this.host.infoLog(`Published "${energyIds(this.model).tileName}" as a Matter outlet with power and energy measurement`)
      this.pushMatter(true)
    } catch (error: any) {
      const message = String(error?.message ?? error)
      // Only "still starting" is worth waiting for; anything else (Matter not
      // enabled on this bridge, validation) will not fix itself
      if (/still starting/i.test(message) && attempt < MATTER_REGISTER_ATTEMPTS) {
        this.host.debugLog(`Matter server still starting, retrying energy tile registration (${attempt}/${MATTER_REGISTER_ATTEMPTS})`)
        this.matterRetryTimer = setTimeout(() => void this.registerMatter(attempt + 1), MATTER_REGISTER_RETRY_MS)
        return
      }
      this.fallBackToHap(message.split('\n')[0])
    }
  }

  /**
   * Send changed values to the Matter tile. Energy goes out at most once a
   * MATTER_ENERGY_INTERVAL_MS unless forced (register, cycle end, shutdown).
   */
  private pushMatter(forceEnergy = false): void {
    if (!this.matterRegistered || !this.matterUuid) {
      return
    }
    const api = this.host.matterApi
    const send = (cluster: string, attributes: Record<string, unknown>): void => {
      Promise.resolve(api.updateAccessoryState(this.matterUuid, cluster, attributes))
        .catch((error: any) => this.host.debugLog(`Matter ${cluster} update failed: ${error?.message ?? error}`))
    }
    if (this.lastMatter.onOff !== this.current.active) {
      this.lastMatter.onOff = this.current.active
      send('onOff', { onOff: this.current.active })
    }
    const activePower = toMilliwatts(this.meter.watts)
    if (this.lastMatter.activePower !== activePower) {
      this.lastMatter.activePower = activePower
      send('electricalPowerMeasurement', { activePower })
    }
    const now = Date.now()
    const energy = toMilliwattHours(this.meter.totalKwh)
    if (energy !== this.lastMatter.energy && (forceEnergy || now - this.lastMatterEnergyMs >= MATTER_ENERGY_INTERVAL_MS)) {
      this.lastMatter.energy = energy
      this.lastMatterEnergyMs = now
      send('electricalEnergyMeasurement', {
        cumulativeEnergyImported: { energy },
      })
    }
  }

  // --- estimate -------------------------------------------------------------

  /** Called by the platform with each websocket push for this appliance. */
  onErdUpdate(erd: string, value: string): void {
    const key = erd.toLowerCase()
    if (this.watched.has(key)) {
      this.values.set(key, value)
      this.lastValueAt = Date.now()
      this.recompute()
    }
  }

  /**
   * Debug aid: log the ERD that looks like a real energy reading but has no
   * known decoding yet, so a debug log from a real appliance can replace this
   * estimate with measured values later.
   */
  private async logRawPowerErd(): Promise<void> {
    const erds: string[] = [ERD_TYPES.RESOURCE_MANAGEMENT_V1_ELECTRICAL_ENERGY_USAGE_V2]
    if (this.model.key === 'washer' || this.model.key === 'washerDryer') {
      erds.push(ERD_TYPES.LAUNDRY_WASHER_LINE_CURRENT)
    }
    for (const erd of erds) {
      const raw = await this.host.readErd(erd).catch(() => undefined)
      if (raw !== undefined) {
        this.rawPowerErds[erd] = raw
        this.host.debugLog(`Raw power ERD ${erd}: ${raw}`)
      }
    }
  }

  /** Full re-read of the ERDs the estimate uses (live cache first, then REST). */
  async refresh(): Promise<void> {
    try {
      for (const erd of this.model.erds) {
        const value = await this.host.readErd(erd)
        if (value !== undefined) {
          this.values.set(erd.toLowerCase(), value)
          this.lastValueAt = Date.now()
        }
      }
      this.recompute()
    } catch (error: any) {
      this.host.warnLog(`Energy estimate refresh failed: ${error?.message ?? error}`)
    }
  }

  private context() {
    return {
      erd: (e: string) => this.values.get(e.toLowerCase()),
      externalActive: this.host.externalActive?.(),
    }
  }

  private recompute(): void {
    const ctx = this.context()
    const next = this.model.estimate(ctx, this.profile)
    const now = Date.now()
    const before = this.meter.totalKwh
    const starting = next.active && !this.wasActive
    if (starting) {
      this.meter.update(this.meter.watts, now)
      this.meter.cycleKwh = 0
    }
    const changed = next.watts !== this.meter.watts
    this.meter.update(next.watts, now)
    this.host.history?.addEnergy(this.storeKey, this.meter.totalKwh - before, now)
    this.current = next
    if (starting && !this.model.alwaysOn) {
      this.cycleStart = now
      this.cyclePeak = 0
      this.cycleName = undefined
    }
    if (next.active && this.cycleStart !== undefined) {
      this.cyclePeak = Math.max(this.cyclePeak, next.watts)
      // The programme is often reported a moment after the machine starts
      this.cycleName ??= this.model.cycleName?.(ctx)
    }
    const finished = !next.active && this.wasActive && !this.model.alwaysOn
    if (finished) {
      this.host.infoLog(`Finished, estimated ${round3(this.meter.cycleKwh)} kWh (total ${round3(this.meter.totalKwh)} kWh)`)
      if (this.cycleStart !== undefined) {
        this.host.history?.addCycle({
          key: this.storeKey,
          name: this.host.name ?? energyIds(this.model).tileName,
          ...(this.cycleName
            ? { cycle: this.cycleName }
            : {}),
          start: this.cycleStart,
          end: now,
          kwh: round3(this.meter.cycleKwh),
          peakWatts: this.cyclePeak,
        })
      }
      this.cycleStart = undefined
    }
    this.wasActive = next.active
    if (changed) {
      this.host.debugLog(`Estimated power ${next.watts} W (${[...this.values].map(([k, v]) => `${k}=${v}`).join(' ')})`)
    }
    this.push(finished)
  }

  /** The live state the dashboard shows. */
  status(): EnergyStatus {
    const ids = energyIds(this.model)
    let description: string | undefined
    try {
      description = this.model.describe?.(this.context())
    } catch {
      description = undefined
    }
    return {
      key: this.storeKey,
      applianceId: this.host.applianceId,
      name: this.host.name ?? ids.tileName,
      tileName: ids.tileName,
      model: this.model.key,
      label: this.model.label,
      protocolWanted: resolveEnergyProtocol(this.host.device),
      protocol: this.protocol,
      ...(this.fallbackReason
        ? { fallbackReason: this.fallbackReason }
        : {}),
      matterRegistered: this.matterRegistered,
      watts: this.meter.watts,
      active: this.current.active,
      ...(description
        ? { description }
        : {}),
      totalKwh: round3(this.meter.totalKwh),
      ...(this.cycleStart !== undefined
        ? {
            cycle: {
              ...(this.cycleName
                ? { name: this.cycleName }
                : {}),
              start: this.cycleStart,
              kwh: round3(this.meter.cycleKwh),
              peakWatts: this.cyclePeak,
            },
          }
        : {}),
      fixed: this.model.fixed === true,
      alwaysOn: this.model.alwaysOn === true,
      profile: { ...this.profile },
      defaults: { ...this.model.defaults },
      erds: Object.fromEntries(this.values),
      ...(this.lastValueAt !== undefined
        ? { lastValueAt: this.lastValueAt }
        : {}),
      rawPowerErds: { ...this.rawPowerErds },
      startedAt: this.startedAt,
    }
  }

  private tick(): void {
    // Recompute rather than just integrate: cheap (no I/O), and it picks up
    // state that does not arrive as an ERD push (the v2 smoker)
    this.recompute()
  }

  private push(forceEnergy = false): void {
    if (this.protocol === 'matter') {
      this.pushMatter(forceEnergy)
    } else {
      this.pushHap()
    }
    this.host.store.set(this.storeKey, this.meter.totalKwh)
  }

  /** Stop the timers and record the final total. The platform flushes the store. */
  shutdown(): void {
    this.stopped = true
    for (const timer of [this.tickTimer, this.refreshTimer]) {
      if (timer) {
        clearInterval(timer)
      }
    }
    for (const timer of [this.snapTimer, this.matterRetryTimer]) {
      if (timer) {
        clearTimeout(timer)
      }
    }
    this.tickTimer = this.refreshTimer = this.snapTimer = this.matterRetryTimer = undefined
    const before = this.meter.totalKwh
    this.meter.update(this.meter.watts)
    this.host.history?.addEnergy(this.storeKey, this.meter.totalKwh - before)
    this.host.store.set(this.storeKey, this.meter.totalKwh)
  }
}
