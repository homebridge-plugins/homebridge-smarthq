/* Copyright(C) 2021-2026, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * keurig.ts: @homebridge-plugins/homebridge-smarthq.
 *
 * Separate HomeKit accessory for the in-fridge Keurig K-Cup brewer
 * (e.g. GE PYE22PYNHFS). Backed by the parent refrigerator's ERDs but
 * exposed as its own accessory so Apple Home / Siri can address it
 * cleanly without being lost among the fridge's ~15 other services.
 */
import type { PlatformAccessory } from 'homebridge'

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

  const tankFull = tankByte === '01' ? true : tankByte === '00' ? false : null
  const brewModulePresent = moduleByte === '01' ? true : moduleByte === '00' ? false : null
  const podStatus = POD_STATUS_BYTE_MAP[podByte] ?? 'NA'
  const faulted = status === 'FAULT_NEED_CLEARED' || status === 'FAULT_LOCKED_OUT'

  return {
    status,
    timeUntilReadyMinutes: Number.isNaN(time) ? null : time,
    currentTempF: Number.isNaN(temp) ? null : temp,
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

export class SmartHQKeurig extends deviceBase {
  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    // K-Cup Hot Water enable switch.
    // On  -> write HOT_WATER_SET_TEMP = 0xBE (190 °F, K-Cup brewing temp)
    // Off -> write HOT_WATER_SET_TEMP = 0x00 (heater disabled)
    // Read state derives from "target temp is non-zero".
    // Mirrors simbaja/ha_gehome's GeKCupSwitch.
    const kcupSwitch = this.accessory!.getService('K-Cup Hot Water')
      ?? this.accessory!.addService(this.platform.Service.Switch, 'K-Cup Hot Water', 'KeurigKCupSwitch')
    kcupSwitch.setCharacteristic(this.platform.Characteristic.Name, 'K-Cup Hot Water')
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
        await this.writeErd(ERD_TYPES.HOT_WATER_SET_TEMP, value ? 'BE' : '00')
      })

    // Hot Water Ready — occupied when HOT_WATER_STATUS.status === READY
    const readySensor = this.accessory!.getService('Hot Water Ready')
      ?? this.accessory!.addService(this.platform.Service.OccupancySensor, 'Hot Water Ready', 'KeurigReady')
    readySensor.setCharacteristic(this.platform.Characteristic.Name, 'Hot Water Ready')
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
    dispensingSensor.setCharacteristic(this.platform.Characteristic.Name, 'Hot Water Dispensing')
    dispensingSensor
      .getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.HOT_WATER_IN_USE)
        const isUsing = r ? Number.parseInt(r, 16) !== 0 : false
        return isUsing
          ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
          : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
      })
  }
}
