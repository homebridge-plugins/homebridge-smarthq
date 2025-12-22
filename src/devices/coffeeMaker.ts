/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * coffeeMaker.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { deviceBase } from './device.js'

export class SmartHQCoffeeMaker extends deviceBase {
  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.debugLog(`Coffee Maker Features: ${JSON.stringify(accessory.context.device.features)}`)

    // Coffee Maker Brewing State (Valve)
    const brewValve = this.accessory.getService('Coffee Maker') ?? this.accessory.addService(this.platform.Service.Valve, 'Coffee Maker', 'CoffeeMaker')
    brewValve.setCharacteristic(this.platform.Characteristic.Name, 'Coffee Maker')
    brewValve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)
    brewValve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        try {
          // TODO: Implement brewing state ERD
          return this.platform.Characteristic.Active.INACTIVE
        } catch (error: any) {
          this.warnLog?.(`Coffee Maker Active error: ${error?.message ?? error}`)
          return this.platform.Characteristic.Active.INACTIVE
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement brew control ERD
          this.debugLog(`Coffee Maker brew set to: ${value}`)
        } catch (error: any) {
          this.warnLog?.(`Coffee Maker brew set error: ${error?.message ?? error}`)
        }
      })

    brewValve
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        try {
          // TODO: Implement brewing state ERD
          return this.platform.Characteristic.InUse.NOT_IN_USE
        } catch (error: any) {
          this.warnLog?.(`Coffee Maker InUse error: ${error?.message ?? error}`)
          return this.platform.Characteristic.InUse.NOT_IN_USE
        }
      })

    // Water Level Sensor (Humidity as proxy)
    const waterLevel = this.accessory.getService('Water Level') ?? this.accessory.addService(this.platform.Service.HumiditySensor, 'Water Level', 'WaterLevel')
    waterLevel.setCharacteristic(this.platform.Characteristic.Name, 'Water Level')
    waterLevel
      .getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(async () => {
        try {
          // TODO: Implement water level ERD (0-100%)
          return 100
        } catch (error: any) {
          this.warnLog?.(`Coffee Maker Water Level error: ${error?.message ?? error}`)
          return 0
        }
      })

    // Filter/Cleaning Status
    const filterService = this.accessory.getService('Coffee Filter') ?? this.accessory.addService(this.platform.Service.FilterMaintenance, 'Coffee Filter', 'CoffeeFilter')
    filterService.setCharacteristic(this.platform.Characteristic.Name, 'Coffee Filter')
    filterService
      .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(async () => {
        try {
          // TODO: Implement filter/cleaning status ERD
          return this.platform.Characteristic.FilterChangeIndication.FILTER_OK
        } catch (error: any) {
          this.warnLog?.(`Coffee Filter Status error: ${error?.message ?? error}`)
          return this.platform.Characteristic.FilterChangeIndication.FILTER_OK
        }
      })
  }
}
