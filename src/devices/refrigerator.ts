/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * oven.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import axios from 'axios'
import { interval, skipWhile } from 'rxjs'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

export class SmartHQRefrigerator extends deviceBase {
  // Updates
  SensorUpdateInProgress!: boolean
  deviceStatus: any

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.debugLog(`Refrigerator Features: ${JSON.stringify(accessory.context.device.features)}`)
    // Add separate contact sensors for refrigerator and door status

    // Refrigerator Door Sensor
    const doorSensorService = this.accessory.getService('Refrigerator Door') ?? this.accessory.addService(this.platform.Service.ContactSensor, 'Refrigerator Door', 'RefrigeratorDoor')
    doorSensorService
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        try {
          const r = await this.readErd(ERD_TYPES.DOOR_STATUS)
          return Number.parseInt(r) !== 0
        } catch (error: any) {
          this.warnLog?.(`Refrigerator Door Sensor readErd error: ${error?.message ?? error}`)
          return false
        }
      })

    // Refrigerator Main Sensor (if you want a separate one, e.g. for overall status)
    const fridgeSensorService = this.accessory.getService('Refrigerator') ?? this.accessory.addService(this.platform.Service.ContactSensor, 'Refrigerator', 'RefrigeratorMain')
    fridgeSensorService
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        try {
          const r = await this.readErd(ERD_TYPES.FRIDGE_MODEL_INFO)
          return Number.parseInt(r) !== 0
        } catch (error: any) {
          this.warnLog?.(`Refrigerator Main Sensor readErd error: ${error?.message ?? error}`)
          return false
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
