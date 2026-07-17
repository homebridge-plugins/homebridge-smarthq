/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * waterFilter.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

export class SmartHQWaterFilter extends deviceBase {
  private filterService: Service
  private valveService: Service
  private leakService: Service
  private batteryService?: Service

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.debugLog(`Water Filter Features: ${JSON.stringify(accessory.context.device.features)}`)

    // Per-device config is looked up by applianceId as the device record passed
    // in does not carry the custom per-device properties
    const configuredDevices = (platform.config as { devices?: devicesConfig[] }).devices ?? []
    const waterFilterConfig = configuredDevices.find(config => config.applianceId === device.applianceId) ?? device
    const showFilterBattery = waterFilterConfig.showFilterBattery ?? false

    // Filter life as a battery (opt-in): HomeKit has no native tile for filter
    // life, so this surfaces the percentage and a low warning the way battery
    // levels show (#10)
    if (showFilterBattery) {
      this.batteryService = this.accessory!.getService('Filter Life') ?? this.accessory!.addService(this.platform.Service.Battery, 'Filter Life', 'FilterLife')
      this.batteryService.setCharacteristic(this.platform.Characteristic.Name, 'Filter Life')
      this.batteryService.setCharacteristic(this.platform.Characteristic.ChargingState, this.platform.Characteristic.ChargingState.NOT_CHARGEABLE)
      this.batteryService
        .getCharacteristic(this.platform.Characteristic.BatteryLevel)
        .onGet(async () => {
          const life = await this.getFilterLifePercent()
          return life ?? 100
        })
      this.batteryService
        .getCharacteristic(this.platform.Characteristic.StatusLowBattery)
        .onGet(async () => {
          const life = await this.getFilterLifePercent()
          return life !== null && life <= 10
            ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
        })
    } else {
      const staleBattery = this.accessory!.getService('Filter Life')
      if (staleBattery) {
        this.accessory!.removeService(staleBattery)
      }
    }

    // Water Filter Maintenance
    this.filterService = this.accessory!.getService('Water Filter') ?? this.accessory!.addService(this.platform.Service.FilterMaintenance, 'Water Filter', 'WaterFilter')
    this.filterService.setCharacteristic(this.platform.Characteristic.Name, 'Water Filter')
    this.filterService
      .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(async () => {
        const life = await this.getFilterLifePercent()
        return life !== null && life <= 10
          ? this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER
          : this.platform.Characteristic.FilterChangeIndication.FILTER_OK
      })

    this.filterService
      .getCharacteristic(this.platform.Characteristic.FilterLifeLevel)
      .onGet(async () => {
        const life = await this.getFilterLifePercent()
        return life ?? 100
      })

    // Water Flow Valve: both Active and InUse follow the live flow rate, so
    // the Home app tile reads a plain Off/Running. Deriving Active from the
    // valve-state erd instead showed "Stopping" (in use but inactive) on
    // filters that report that erd differently to the GXWH70M (#10)
    this.valveService = this.accessory!.getService('Water Flow') ?? this.accessory!.addService(this.platform.Service.Valve, 'Water Flow', 'WaterFlow')
    this.valveService.setCharacteristic(this.platform.Characteristic.Name, 'Water Flow')
    this.valveService.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.WATER_FAUCET)
    this.valveService
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        const flowing = await this.isWaterFlowing()
        return flowing
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE
      })

    this.valveService
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        const flowing = await this.isWaterFlowing()
        return flowing
          ? this.platform.Characteristic.InUse.IN_USE
          : this.platform.Characteristic.InUse.NOT_IN_USE
      })

    // Leak Sensor: combines the filter's leak detection with its flow alert,
    // so continuous unexpected flow also raises a HomeKit leak notification
    this.leakService = this.accessory!.getService('Water Leak') ?? this.accessory!.addService(this.platform.Service.LeakSensor, 'Water Leak', 'WaterLeak')
    this.leakService.setCharacteristic(this.platform.Characteristic.Name, 'Water Leak')
    this.leakService
      .getCharacteristic(this.platform.Characteristic.LeakDetected)
      .onGet(async () => {
        const leak = await this.isLeakDetected()
        return leak
          ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED
          : this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED
      })
  }

  /**
   * Reflect a pushed ERD change in HomeKit as it happens, instead of waiting
   * for HomeKit to ask. The platform stores the pushed value in its live
   * cache before calling this, so the existing read helpers see fresh data
   * (#10).
   */
  onErdUpdate(erd: string): void {
    void this.applyLiveUpdate(erd)
  }

  private async applyLiveUpdate(erd: string): Promise<void> {
    try {
      switch (erd) {
        case ERD_TYPES.WATER_FILTER_VALVE_STATE: {
          // Not mapped to a characteristic yet — models disagree on what they
          // report here, so collect the raw values for a future mode tile
          const r = await this.readErd(ERD_TYPES.WATER_FILTER_VALVE_STATE)
          this.debugLog(`Water filter valve state raw: ${r ?? 'not reported'}`)
          break
        }
        case ERD_TYPES.WATER_FILTER_FLOW_RATE: {
          const flowing = await this.isWaterFlowing()
          this.valveService.updateCharacteristic(
            this.platform.Characteristic.Active,
            flowing
              ? this.platform.Characteristic.Active.ACTIVE
              : this.platform.Characteristic.Active.INACTIVE,
          )
          this.valveService.updateCharacteristic(
            this.platform.Characteristic.InUse,
            flowing
              ? this.platform.Characteristic.InUse.IN_USE
              : this.platform.Characteristic.InUse.NOT_IN_USE,
          )
          break
        }
        case ERD_TYPES.WATER_FILTER_LIFE_REMAINING: {
          const life = await this.getFilterLifePercent()
          this.filterService.updateCharacteristic(this.platform.Characteristic.FilterLifeLevel, life ?? 100)
          this.filterService.updateCharacteristic(
            this.platform.Characteristic.FilterChangeIndication,
            life !== null && life <= 10
              ? this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER
              : this.platform.Characteristic.FilterChangeIndication.FILTER_OK,
          )
          this.batteryService?.updateCharacteristic(this.platform.Characteristic.BatteryLevel, life ?? 100)
          this.batteryService?.updateCharacteristic(
            this.platform.Characteristic.StatusLowBattery,
            life !== null && life <= 10
              ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
              : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
          )
          break
        }
        case ERD_TYPES.WATER_FILTER_LEAK_VALIDITY:
        case ERD_TYPES.WATER_FILTER_FLOW_ALERT: {
          const leak = await this.isLeakDetected()
          this.leakService.updateCharacteristic(
            this.platform.Characteristic.LeakDetected,
            leak
              ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED
              : this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
          )
          break
        }
      }
    } catch (error: any) {
      this.warnLog?.(`Water Filter live update error: ${error?.message ?? error}`)
    }
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
