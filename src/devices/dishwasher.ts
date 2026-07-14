/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * oven.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { interval, skipWhile } from 'rxjs'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

export class SmartHQDishWasher extends deviceBase {
  // Updates
  SensorUpdateInProgress!: boolean
  deviceStatus: any

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.debugLog(`Dishwasher Features: ${JSON.stringify(accessory.context.device.features)}`)

    // Dishwasher Running State (Valve for active/inactive)
    const dishwasherValve = this.accessory.getService('Dishwasher') ?? this.accessory.addService(this.platform.Service.Valve, 'Dishwasher', 'Dishwasher')
    dishwasherValve.setCharacteristic(this.platform.Characteristic.Name, 'Dishwasher')
    dishwasherValve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)
    dishwasherValve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        try {
          const r = await this.readErd(ERD_TYPES.DISHWASHER_CYCLE)
          return r && Number.parseInt(r) !== 0 ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE
        } catch (error: any) {
          this.warnLog?.(`Dishwasher Active error: ${error?.message ?? error}`)
          return this.platform.Characteristic.Active.INACTIVE
        }
      })
      .onSet(async (value) => {
        try {
          await this.writeErd(ERD_TYPES.DISHWASHER_CYCLE, value === this.platform.Characteristic.Active.ACTIVE)
        } catch (error: any) {
          this.warnLog?.(`Dishwasher Active set error: ${error?.message ?? error}`)
        }
      })

    dishwasherValve
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        try {
          const r = await this.readErd(ERD_TYPES.DISHWASHER_CYCLE)
          return r && Number.parseInt(r) !== 0 ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE
        } catch (error: any) {
          this.warnLog?.(`Dishwasher InUse error: ${error?.message ?? error}`)
          return this.platform.Characteristic.InUse.NOT_IN_USE
        }
      })

    // Dishwasher Door Sensor
    const doorSensor = this.accessory.getService('Dishwasher Door') ?? this.accessory.addService(this.platform.Service.ContactSensor, 'Dishwasher Door', 'DishwasherDoor')
    doorSensor.setCharacteristic(this.platform.Characteristic.Name, 'Dishwasher Door')
    doorSensor
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.LAUNDRY_DOOR)
        // 0=closed (detected), 1=open (not detected)
        return r && Number.parseInt(r) === 1
          ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
      })

    // this is subject we use to track when we need to POST changes to the SmartHQ API
    this.SensorUpdateInProgress = false

    // Retrieve initial values and updateHomekit
    // this.refreshStatus()

    // Start an update interval
    interval(this.deviceRefreshRate * 10000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(async () => {
        // await this.refreshStatus()
      })
  }
}
