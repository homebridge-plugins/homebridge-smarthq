/* Copyright(C) 2021-2026, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * keurig.ts: @homebridge-plugins/homebridge-smarthq.
 *
 * Separate HomeKit accessory for the in-fridge Keurig K-Cup brewer
 * (e.g. GE PYE22PYNHFS). Backed by the parent refrigerator's ERDs but
 * exposed as its own accessory so Apple Home / Siri can address it
 * cleanly without being lost among the fridge's ~15 other services.
 */
import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, ErdHotWaterStatusValue, ErdPodStatusValue, HotWaterStatus, SmartHqContext } from '../settings.js'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

const HOT_WATER_STATUS_BYTE_MAP: Record<string, ErdHotWaterStatusValue> = {
  '00': 'NOT_HEATING',
  '01': 'HEATING',
  '02': 'READY',
  'FD': 'FAULT_NEED_CLEARED',
  'FE': 'FAULT_LOCKED_OUT',
}

const POD_STATUS_BYTE_MAP: Record<string, ErdPodStatusValue> = {
  '00': 'REPLACE',
  '01': 'READY',
  'FF': 'NA',
}

const HOT_WATER_STATUS_SAFE_DEFAULT: HotWaterStatus = {
  status: 'NA',
  timeUntilReadyMinutes: null,
  currentTempF: null,
  tankFull: null,
  brewModulePresent: null,
  podStatus: 'NA',
  faulted: false,
}

export function parseHotWaterStatus(raw: string | undefined): HotWaterStatus {
  if (!raw || typeof raw !== 'string') {
    return HOT_WATER_STATUS_SAFE_DEFAULT
  }
  const hex = raw.replace(/^0x/i, '').toUpperCase()
  if (!/^[0-9A-F]+$/.test(hex) || hex.length < 14) {
    return HOT_WATER_STATUS_SAFE_DEFAULT
  }

  const statusByte = hex.substring(0, 2)
  const status = HOT_WATER_STATUS_BYTE_MAP[statusByte] ?? 'NA'
  const time = Number.parseInt(hex.substring(2, 6), 16)
  const temp = Number.parseInt(hex.substring(6, 8), 16)
  const tankByte = hex.substring(8, 10)
  const moduleByte = hex.substring(10, 12)
  const podByte = hex.substring(12, 14)

  const tankFull = tankByte === '01'
    ? true
    : tankByte === '00'
      ? false
      : null
  const brewModulePresent = moduleByte === '01'
    ? true
    : moduleByte === '00'
      ? false
      : null
  const podStatus = POD_STATUS_BYTE_MAP[podByte] ?? 'NA'
  const faulted = status === 'FAULT_NEED_CLEARED' || status === 'FAULT_LOCKED_OUT'

  return {
    status,
    timeUntilReadyMinutes: Number.isNaN(time)
      ? null
      : time,
    currentTempF: Number.isNaN(temp)
      ? null
      : temp,
    tankFull,
    brewModulePresent,
    podStatus,
    faulted,
  }
}

export function decideKeurigCapability(
  configOverride: boolean | undefined,
  status: HotWaterStatus,
): boolean {
  if (configOverride === false) {
    return false
  }
  if (configOverride === true) {
    return true
  }
  // Mirror simbaja/ha_gehome's detection: any non-NA hot-water status
  // means the fridge has a controllable hot-water/Keurig dispenser. Pod
  // and brew_module bytes can take undocumented values across models
  // (PYE22PYNHFS returns brew_module=0x03, outside gehome's enum), so
  // requiring those would miss real Keurig fridges.
  return status.status !== 'NA'
}

// Target temperatures written to HOT_WATER_SET_TEMP (0x1011) when the
// switch turns on. Keurig models brew at 190 °F (0xBE). Fridges with a
// plain hot-water dispenser and no brew module accept 0xBE but never start
// heating; 185 °F (0xB9) and below heat right away (the SmartHQ app writes
// 170 °F / 0xAA on these models).
export const KCUP_SET_TEMP_HEX = 'BE'
export const DISPENSER_SET_TEMP_HEX = 'B9'

/**
 * Pick the 0x1011 value for "on" from a raw HOT_WATER_STATUS frame.
 * Byte 6 (brew module) is FF on fridges without a Keurig brew module;
 * Keurig models report 00, 01 or 03. Unreadable status keeps the 190 °F
 * K-Cup default. A configured temperature (°F) wins over both.
 */
export function hotWaterOnSetTemp(rawStatus: string | undefined, configuredTempF?: number): string {
  if (Number.isInteger(configuredTempF) && configuredTempF! >= 100 && configuredTempF! <= 200) {
    return configuredTempF!.toString(16).toUpperCase().padStart(2, '0')
  }
  if (!rawStatus || typeof rawStatus !== 'string') {
    return KCUP_SET_TEMP_HEX
  }
  const hex = rawStatus.replace(/^0x/i, '').toUpperCase()
  if (!/^[0-9A-F]+$/.test(hex) || hex.length < 14) {
    return KCUP_SET_TEMP_HEX
  }
  return hex.substring(10, 12) === 'FF'
    ? DISPENSER_SET_TEMP_HEX
    : KCUP_SET_TEMP_HEX
}

// How often to check the hot water directly while the switch is on. SmartHQ
// keeps the websocket open but does not always push the change to READY.
export const HOT_WATER_CHECK_MS = 15_000

export class SmartHQKeurig extends deviceBase {
  private hotWaterCheck?: ReturnType<typeof setInterval>
  private hotWaterChecking = false
  private kcupSwitch?: Service
  private readySensor?: Service
  private dispensingSensor?: Service

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    // K-Cup Hot Water enable switch.
    // On  -> write HOT_WATER_SET_TEMP = 0xBE (190 °F, K-Cup brewing temp),
    //        or 0xB9 (185 °F) on dispensers without a brew module, which
    //        never heat at 190 °F (see hotWaterOnSetTemp)
    // Off -> write HOT_WATER_SET_TEMP = 0x00 (heater disabled)
    // Read state derives from "target temp is non-zero".
    // Mirrors simbaja/ha_gehome's GeKCupSwitch.
    const kcupSwitch = this.accessory!.getService('K-Cup Hot Water')
      ?? this.accessory!.addService(this.platform.Service.Switch, 'K-Cup Hot Water', 'KeurigKCupSwitch')
    this.setServiceName(kcupSwitch, 'K-Cup Hot Water')
    kcupSwitch
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.HOT_WATER_SET_TEMP)
        if (!r) {
          return false
        }
        return Number.parseInt(r, 16) !== 0
      })
      .onSet(async (value) => {
        if (!value) {
          this.stopHotWaterCheck()
          await this.writeErd(ERD_TYPES.HOT_WATER_SET_TEMP, '00')
          return
        }
        const status = await this.readErd(ERD_TYPES.HOT_WATER_STATUS)
        await this.writeErd(ERD_TYPES.HOT_WATER_SET_TEMP, hotWaterOnSetTemp(status, this.device.hotWaterTemp))
        this.startHotWaterCheck()
      })

    this.kcupSwitch = kcupSwitch

    // Hot Water Ready — occupied when HOT_WATER_STATUS.status === READY
    const readySensor = this.accessory!.getService('Hot Water Ready')
      ?? this.accessory!.addService(this.platform.Service.OccupancySensor, 'Hot Water Ready', 'KeurigReady')
    this.setServiceName(readySensor, 'Hot Water Ready')
    readySensor
      .getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.HOT_WATER_STATUS)
        const parsed = parseHotWaterStatus(r)
        return parsed.status === 'READY'
          ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
          : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
      })

    // Hot Water Dispensing — occupied while a brew/dispense is in progress
    const dispensingSensor = this.accessory!.getService('Hot Water Dispensing')
      ?? this.accessory!.addService(this.platform.Service.OccupancySensor, 'Hot Water Dispensing', 'KeurigDispensing')
    this.setServiceName(dispensingSensor, 'Hot Water Dispensing')
    this.readySensor = readySensor
    this.dispensingSensor = dispensingSensor

    // The heater may already be on from before a restart
    void (async () => {
      try {
        const setTemp = await this.readErd(ERD_TYPES.HOT_WATER_SET_TEMP)
        if (setTemp && Number.parseInt(setTemp, 16) > 0) {
          this.startHotWaterCheck()
        }
      } catch {
        // checks start the next time the switch turns on
      }
    })()
    dispensingSensor
      .getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.HOT_WATER_IN_USE)
        const isUsing = r
          ? Number.parseInt(r, 16) !== 0
          : false
        return isUsing
          ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
          : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
      })
  }

  /**
   * Reflect pushed hot-water ERDs in HomeKit as they happen, so "Hot Water
   * Ready" and "Hot Water Dispensing" can trigger notifications and
   * automations instead of only updating when the Home app reads them.
   */
  onErdUpdate(erd: string, value: string): void {
    const { Characteristic } = this.platform
    const occupancy = (on: boolean) => on
      ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
      : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
    switch (erd) {
      case ERD_TYPES.HOT_WATER_STATUS:
        this.readySensor?.updateCharacteristic(
          Characteristic.OccupancyDetected,
          occupancy(parseHotWaterStatus(value).status === 'READY'),
        )
        break
      case ERD_TYPES.HOT_WATER_IN_USE: {
        const n = Number.parseInt(value, 16)
        this.dispensingSensor?.updateCharacteristic(
          Characteristic.OccupancyDetected,
          occupancy(!Number.isNaN(n) && n !== 0),
        )
        break
      }
      case ERD_TYPES.HOT_WATER_SET_TEMP: {
        const n = Number.parseInt(value, 16)
        if (!Number.isNaN(n)) {
          this.kcupSwitch?.updateCharacteristic(Characteristic.On, n !== 0)
          if (n !== 0) {
            this.startHotWaterCheck()
          } else {
            this.stopHotWaterCheck()
          }
        }
        break
      }
    }
  }

  /** Start checking the hot water directly, if not already. */
  startHotWaterCheck(): void {
    if (this.hotWaterCheck) {
      return
    }
    this.hotWaterCheck = setInterval(() => void this.checkHotWater(), HOT_WATER_CHECK_MS)
  }

  stopHotWaterCheck(): void {
    if (this.hotWaterCheck) {
      clearInterval(this.hotWaterCheck)
      this.hotWaterCheck = undefined
    }
  }

  /**
   * Read the status and set temperature from the API and apply them as if they
   * had been pushed. A set temperature of 00 (heater off) ends the checks.
   */
  async checkHotWater(): Promise<void> {
    if (this.hotWaterChecking) {
      return
    }
    this.hotWaterChecking = true
    try {
      for (const erd of [ERD_TYPES.HOT_WATER_STATUS, ERD_TYPES.HOT_WATER_SET_TEMP]) {
        const value = await this.readErdFresh(erd)
        if (value !== undefined) {
          this.onErdUpdate(erd, value)
        }
      }
    } catch (error: any) {
      await this.debugLog(`Hot water check failed: ${error?.message ?? error}`)
    } finally {
      this.hotWaterChecking = false
    }
  }

  /** Called by the platform on the way out. */
  public shutdown(): void {
    this.stopHotWaterCheck()
  }
}
