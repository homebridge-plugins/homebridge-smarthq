/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * waterSoftener.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { deviceBase } from './device.js'

export class SmartHQWaterSoftener extends deviceBase {
  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.debugLog(`Water Softener Features: ${JSON.stringify(accessory.context.device.features)}`)

    // Water Softener Filter/Salt Status
    const filterService = this.accessory!.getService('Softener Salt') ?? this.accessory!.addService(this.platform.Service.FilterMaintenance, 'Softener Salt', 'SoftenerSalt')
    this.setServiceName(filterService, 'Softener Salt')
    filterService
      .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(async () => {
        try {
          // TODO: Implement salt level ERD
          return this.platform.Characteristic.FilterChangeIndication.FILTER_OK
        } catch (error: any) {
          this.warnLog?.(`Softener Salt Status error: ${error?.message ?? error}`)
          return this.platform.Characteristic.FilterChangeIndication.FILTER_OK
        }
      })

    filterService
      .getCharacteristic(this.platform.Characteristic.FilterLifeLevel)
      .onGet(async () => {
        try {
          // TODO: Implement salt level percentage ERD
          return 100
        } catch (error: any) {
          this.warnLog?.(`Softener Salt Level error: ${error?.message ?? error}`)
          return 100
        }
      })

    // Water Valve
    const valveService = this.accessory!.getService('Water Softener') ?? this.accessory!.addService(this.platform.Service.Valve, 'Water Softener', 'WaterSoftener')
    this.setServiceName(valveService, 'Water Softener')
    valveService.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.WATER_FAUCET)
    valveService
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        try {
          // TODO: Implement softener active state ERD
          return this.platform.Characteristic.Active.ACTIVE
        } catch (error: any) {
          this.warnLog?.(`Water Softener Active error: ${error?.message ?? error}`)
          return this.platform.Characteristic.Active.INACTIVE
        }
      })

    valveService
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        try {
          // TODO: Implement softener in-use state ERD
          return this.platform.Characteristic.InUse.IN_USE
        } catch (error: any) {
          this.warnLog?.(`Water Softener InUse error: ${error?.message ?? error}`)
          return this.platform.Characteristic.InUse.NOT_IN_USE
        }
      })
  }
}
