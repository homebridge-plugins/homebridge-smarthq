/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * waterFilter.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

export class SmartHQWaterFilter extends deviceBase {
  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.debugLog(`Water Filter Features: ${JSON.stringify(accessory.context.device.features)}`)

    // Water Filter Maintenance
    const filterService = this.accessory!.getService('Water Filter') ?? this.accessory!.addService(this.platform.Service.FilterMaintenance, 'Water Filter', 'WaterFilter')
    filterService.setCharacteristic(this.platform.Characteristic.Name, 'Water Filter')
    filterService
      .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(async () => {
        const life = await this.getFilterLifePercent()
        return life !== null && life <= 10
          ? this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER
          : this.platform.Characteristic.FilterChangeIndication.FILTER_OK
      })

    filterService
      .getCharacteristic(this.platform.Characteristic.FilterLifeLevel)
      .onGet(async () => {
        const life = await this.getFilterLifePercent()
        return life ?? 100
      })

    // Water Flow Valve: active when the valve is in its filtered position,
    // in use when water is actually flowing
    const valveService = this.accessory!.getService('Water Flow') ?? this.accessory!.addService(this.platform.Service.Valve, 'Water Flow', 'WaterFlow')
    valveService.setCharacteristic(this.platform.Characteristic.Name, 'Water Flow')
    valveService.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.WATER_FAUCET)
    valveService
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        try {
          // gehome ErdWaterFilterValveState: 0 bypass, 1 off, 2 filtered, 3 manual override
          const r = await this.readErd(ERD_TYPES.WATER_FILTER_VALVE_STATE)
          const state = r ? Number.parseInt(r, 16) : -1
          return [2, 3].includes(state)
            ? this.platform.Characteristic.Active.ACTIVE
            : this.platform.Characteristic.Active.INACTIVE
        } catch (error: any) {
          this.warnLog?.(`Water Flow error: ${error?.message ?? error}`)
          return this.platform.Characteristic.Active.INACTIVE
        }
      })

    valveService
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        const flowing = await this.isWaterFlowing()
        return flowing
          ? this.platform.Characteristic.InUse.IN_USE
          : this.platform.Characteristic.InUse.NOT_IN_USE
      })

    // Leak Sensor: combines the filter's leak detection with its flow alert,
    // so continuous unexpected flow also raises a HomeKit leak notification
    const leakService = this.accessory!.getService('Water Leak') ?? this.accessory!.addService(this.platform.Service.LeakSensor, 'Water Leak', 'WaterLeak')
    leakService.setCharacteristic(this.platform.Characteristic.Name, 'Water Leak')
    leakService
      .getCharacteristic(this.platform.Characteristic.LeakDetected)
      .onGet(async () => {
        const leak = await this.isLeakDetected()
        return leak
          ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED
          : this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED
      })
  }

  /**
   * gehome ErdWaterFilterLifeRemaining: the first 8 hex characters are the
   * remaining life percentage.
   */
  private async getFilterLifePercent(): Promise<number | null> {
    try {
      const r = await this.readErd(ERD_TYPES.WATER_FILTER_LIFE_REMAINING)
      if (!r) {
        return null
      }
      const pct = Number.parseInt(r.slice(0, 8), 16)
      if (Number.isNaN(pct)) {
        return null
      }
      return Math.max(0, Math.min(100, pct))
    } catch (error: any) {
      this.warnLog?.(`Water Filter Life error: ${error?.message ?? error}`)
      return null
    }
  }

  /**
   * gehome ErdWaterFilterFlowRate: raw value / 100 = gallons per minute.
   */
  private async isWaterFlowing(): Promise<boolean> {
    try {
      const r = await this.readErd(ERD_TYPES.WATER_FILTER_FLOW_RATE)
      return !!r && Number.parseInt(r, 16) > 0
    } catch (error: any) {
      this.warnLog?.(`Water Flow rate error: ${error?.message ?? error}`)
      return false
    }
  }

  /**
   * Leak validity (0x116e): 01 means a leak has been detected.
   * Flow alert (0x1169): any of the low three bits set means a flow alert.
   */
  private async isLeakDetected(): Promise<boolean> {
    try {
      const leak = await this.readErd(ERD_TYPES.WATER_FILTER_LEAK_VALIDITY)
      if (leak && Number.parseInt(leak, 16) === 1) {
        return true
      }
      const alert = await this.readErd(ERD_TYPES.WATER_FILTER_FLOW_ALERT)
      return !!alert && (Number.parseInt(alert, 16) & 0b111) !== 0
    } catch (error: any) {
      this.warnLog?.(`Water Leak error: ${error?.message ?? error}`)
      return false
    }
  }
}
