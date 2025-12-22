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

    // Refrigerator Door Sensor
    const doorSensorService = this.accessory.getService('Refrigerator Door') ?? this.accessory.addService(this.platform.Service.ContactSensor, 'Refrigerator Door', 'RefrigeratorDoor')
    doorSensorService.setCharacteristic(this.platform.Characteristic.Name, 'Refrigerator Door')
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

    // Fridge Temperature Sensor
    const fridgeTempService = this.accessory.getService('Fridge Temperature') ?? this.accessory.addService(this.platform.Service.TemperatureSensor, 'Fridge Temperature', 'FridgeTemp')
    fridgeTempService.setCharacteristic(this.platform.Characteristic.Name, 'Fridge Temperature')
    fridgeTempService
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        try {
          const r = await this.readErd(ERD_TYPES.CURRENT_TEMPERATURE)
          // CURRENT_TEMPERATURE returns a byte array: byte 0 = fridge temp (°F), byte 1 = freezer temp (°F)
          // Need to convert from hex string to get first byte
          const bytes = r.match(/.{1,2}/g) || []
          const fridgeTemp = bytes[0] ? Number.parseInt(bytes[0], 16) : 0
          // Convert Fahrenheit to Celsius for HomeKit
          return (fridgeTemp - 32) * 5 / 9
        } catch (error: any) {
          this.warnLog?.(`Fridge Temperature readErd error: ${error?.message ?? error}`)
          return 0
        }
      })

    // Freezer Temperature Sensor
    const freezerTempService = this.accessory.getService('Freezer Temperature') ?? this.accessory.addService(this.platform.Service.TemperatureSensor, 'Freezer Temperature', 'FreezerTemp')
    freezerTempService.setCharacteristic(this.platform.Characteristic.Name, 'Freezer Temperature')
    freezerTempService
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        try {
          const r = await this.readErd(ERD_TYPES.CURRENT_TEMPERATURE)
          // CURRENT_TEMPERATURE returns a byte array: byte 0 = fridge temp (°F), byte 1 = freezer temp (°F)
          const bytes = r.match(/.{1,2}/g) || []
          const freezerTemp = bytes[1] ? Number.parseInt(bytes[1], 16) : 0
          // Convert Fahrenheit to Celsius for HomeKit
          return (freezerTemp - 32) * 5 / 9
        } catch (error: any) {
          this.warnLog?.(`Freezer Temperature readErd error: ${error?.message ?? error}`)
          return 0
        }
      })

    // Air Filter Status
    const filterService = this.accessory.getService('Air Filter') ?? this.accessory.addService(this.platform.Service.FilterMaintenance, 'Air Filter', 'AirFilter')
    filterService.setCharacteristic(this.platform.Characteristic.Name, 'Air Filter')
    filterService
      .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(async () => {
        try {
          const r = await this.readErd(ERD_TYPES.AIR_FILTER_STATUS)
          return Number.parseInt(r) === 1
            ? this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER
            : this.platform.Characteristic.FilterChangeIndication.FILTER_OK
        } catch (error: any) {
          this.warnLog?.(`Air Filter Status readErd error: ${error?.message ?? error}`)
          return this.platform.Characteristic.FilterChangeIndication.FILTER_OK
        }
      })

    // Ice Maker Control (Switch)
    const iceMakerService = this.accessory.getService('Ice Maker') ?? this.accessory.addService(this.platform.Service.Switch, 'Ice Maker', 'IceMaker')
    iceMakerService.setCharacteristic(this.platform.Characteristic.Name, 'Ice Maker')
    iceMakerService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        try {
          const r = await this.readErd(ERD_TYPES.ICE_MAKER_CONTROL)
          return Number.parseInt(r) !== 0
        } catch (error: any) {
          this.warnLog?.(`Ice Maker Control readErd error: ${error?.message ?? error}`)
          return false
        }
      })
      .onSet(async (value) => {
        try {
          await this.writeErd(ERD_TYPES.ICE_MAKER_CONTROL, value as boolean)
        } catch (error: any) {
          this.warnLog?.(`Ice Maker Control writeErd error: ${error?.message ?? error}`)
        }
      })

    // Turbo Cool Switch
    const turboCoolService = this.accessory.getService('Turbo Cool') ?? this.accessory.addService(this.platform.Service.Switch, 'Turbo Cool', 'TurboCool')
    turboCoolService.setCharacteristic(this.platform.Characteristic.Name, 'Turbo Cool')
    turboCoolService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        try {
          const r = await this.readErd(ERD_TYPES.TURBO_COOL_STATUS)
          return Number.parseInt(r) !== 0
        } catch (error: any) {
          this.warnLog?.(`Turbo Cool Status readErd error: ${error?.message ?? error}`)
          return false
        }
      })
      .onSet(async (value) => {
        try {
          await this.writeErd(ERD_TYPES.TURBO_COOL_STATUS, value as boolean)
        } catch (error: any) {
          this.warnLog?.(`Turbo Cool Status writeErd error: ${error?.message ?? error}`)
        }
      })

    // Turbo Freeze Switch
    const turboFreezeService = this.accessory.getService('Turbo Freeze') ?? this.accessory.addService(this.platform.Service.Switch, 'Turbo Freeze', 'TurboFreeze')
    turboFreezeService.setCharacteristic(this.platform.Characteristic.Name, 'Turbo Freeze')
    turboFreezeService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        try {
          const r = await this.readErd(ERD_TYPES.TURBO_FREEZE_STATUS)
          return Number.parseInt(r) !== 0
        } catch (error: any) {
          this.warnLog?.(`Turbo Freeze Status readErd error: ${error?.message ?? error}`)
          return false
        }
      })
      .onSet(async (value) => {
        try {
          await this.writeErd(ERD_TYPES.TURBO_FREEZE_STATUS, value as boolean)
        } catch (error: any) {
          this.warnLog?.(`Turbo Freeze Status writeErd error: ${error?.message ?? error}`)
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
