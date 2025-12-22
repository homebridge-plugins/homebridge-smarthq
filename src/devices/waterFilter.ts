/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * waterFilter.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

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
    const filterService = this.accessory.getService('Water Filter') ?? this.accessory.addService(this.platform.Service.FilterMaintenance, 'Water Filter', 'WaterFilter')
    filterService
      .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(async () => {
        try {
          // TODO: Implement filter status ERD
          return this.platform.Characteristic.FilterChangeIndication.FILTER_OK
        } catch (error: any) {
          this.warnLog?.(`Water Filter Status error: ${error?.message ?? error}`)
          return this.platform.Characteristic.FilterChangeIndication.FILTER_OK
        }
      })

    filterService
      .getCharacteristic(this.platform.Characteristic.FilterLifeLevel)
      .onGet(async () => {
        try {
          // TODO: Implement filter life percentage ERD
          return 100
        } catch (error: any) {
          this.warnLog?.(`Water Filter Life error: ${error?.message ?? error}`)
          return 100
        }
      })

    // Water Flow Valve
    const valveService = this.accessory.getService('Water Flow') ?? this.accessory.addService(this.platform.Service.Valve, 'Water Flow', 'WaterFlow')
    valveService.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.WATER_FAUCET)
    valveService
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        try {
          // TODO: Implement water flow state ERD
          return this.platform.Characteristic.Active.ACTIVE
        } catch (error: any) {
          this.warnLog?.(`Water Flow error: ${error?.message ?? error}`)
          return this.platform.Characteristic.Active.INACTIVE
        }
      })

    valveService
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        try {
          // TODO: Implement water flow state ERD
          return this.platform.Characteristic.InUse.IN_USE
        } catch (error: any) {
          this.warnLog?.(`Water Flow InUse error: ${error?.message ?? error}`)
          return this.platform.Characteristic.InUse.NOT_IN_USE
        }
      })
  }
}
