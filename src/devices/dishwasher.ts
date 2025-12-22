/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * oven.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import axios from 'axios'
import { interval, skipWhile } from 'rxjs'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

export class SmartHQDishWasher extends deviceBase {
  // Service
  private DishWasher!: {
    Service: Service
    Name: CharacteristicValue
    On: CharacteristicValue
  }

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
    dishwasherValve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)
    dishwasherValve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        try {
          return await this.readErd(ERD_TYPES.DISHWASHER_CYCLE).then(r => Number.parseInt(r) !== 0 ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE)
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
          return await this.readErd(ERD_TYPES.DISHWASHER_CYCLE).then(r => Number.parseInt(r) !== 0 ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE)
        } catch (error: any) {
          this.warnLog?.(`Dishwasher InUse error: ${error?.message ?? error}`)
          return this.platform.Characteristic.InUse.NOT_IN_USE
        }
      })

    // Dishwasher Door Sensor
    const doorSensor = this.accessory.getService('Dishwasher Door') ?? this.accessory.addService(this.platform.Service.ContactSensor, 'Dishwasher Door', 'DishwasherDoor')
    doorSensor
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        try {
          // TODO: Use actual door status ERD when available
          return this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
        } catch (error: any) {
          this.warnLog?.(`Dishwasher Door error: ${error?.message ?? error}`)
          return this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
        }
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

  async readErd(erd: string): Promise<string> {
    const d = await axios
      .get(`/appliance/${this.accessory.context.device.applianceId}/erd/${erd}`)
    return String(d.data.value)
  }

  async writeErd(erd: string, value: string | boolean) {
    await axios
      .post(`/appliance/${this.accessory.context.device.applianceId}/erd/${erd}`, {
        kind: 'appliance#erdListEntry',
        userId: this.accessory.context.userId,
        applianceId: this.accessory.context.device.applianceId,
        erd,
        value: typeof value === 'boolean' ? (value ? '01' : '00') : value,
      })
    return undefined
  }
}
