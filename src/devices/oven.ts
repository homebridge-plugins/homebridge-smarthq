/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * oven.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { Buffer } from 'node:buffer'

import axios from 'axios'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

export class SmartHQOven extends deviceBase {
  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.debugLog(`Oven Features: ${JSON.stringify(accessory.context.device.features)}`)

    // Oven Light
    const ovenLight = this.accessory.getService('Oven Light') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'Oven Light', 'OvenLight')
    ovenLight.setCharacteristic(this.platform.Characteristic.Name, 'Oven Light')
    ovenLight
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        try {
          return await this.readErd(ERD_TYPES.UPPER_OVEN_LIGHT).then(r => Number.parseInt(r) !== 0)
        } catch (error: any) {
          this.warnLog?.(`Oven Light handleGetOn error: ${error?.message ?? error}`)
          return false
        }
      })
      .onSet(async (value) => {
        try {
          await this.writeErd(ERD_TYPES.UPPER_OVEN_LIGHT, value as boolean)
        } catch (error: any) {
          this.warnLog?.(`Oven Light handleSetOn error: ${error?.message ?? error}`)
        }
      })

    // Oven Current Temperature Sensor
    const ovenTempSensor = this.accessory.getService('Oven Temperature') ?? this.accessory.addService(this.platform.Service.TemperatureSensor, 'Oven Temperature', 'OvenTemp')
    ovenTempSensor.setCharacteristic(this.platform.Characteristic.Name, 'Oven Temperature')
    ovenTempSensor
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        try {
          const erdVal = await this.readErd(ERD_TYPES.UPPER_OVEN_COOK_MODE)
          const b = Buffer.from(erdVal, 'hex')
          return fToC(b.readUint16BE(1))
        } catch (error: any) {
          this.warnLog?.(`Oven Temperature error: ${error?.message ?? error}`)
          return 0
        }
      })

    // Oven Door Lock (Security System for lock state)
    const ovenDoorLock = this.accessory.getService('Oven Door Lock') ?? this.accessory.addService(this.platform.Service.LockMechanism, 'Oven Door Lock', 'OvenDoorLock')
    ovenDoorLock.setCharacteristic(this.platform.Characteristic.Name, 'Oven Door Lock')
    ovenDoorLock
      .getCharacteristic(this.platform.Characteristic.LockCurrentState)
      .onGet(async () => {
        try {
          // TODO: Use actual ERD for door lock state when available
          return this.platform.Characteristic.LockCurrentState.UNSECURED
        } catch (error: any) {
          this.warnLog?.(`Oven Door Lock error: ${error?.message ?? error}`)
          return this.platform.Characteristic.LockCurrentState.UNSECURED
        }
      })

    ovenDoorLock
      .getCharacteristic(this.platform.Characteristic.LockTargetState)
      .onGet(async () => {
        try {
          // TODO: Use actual ERD for door lock state when available
          return this.platform.Characteristic.LockTargetState.UNSECURED
        } catch (error: any) {
          this.warnLog?.(`Oven Door Lock error: ${error?.message ?? error}`)
          return this.platform.Characteristic.LockTargetState.UNSECURED
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement door lock control when ERD is available
          this.debugLog(`Oven Door Lock set to: ${value}`)
        } catch (error: any) {
          this.warnLog?.(`Oven Door Lock set error: ${error?.message ?? error}`)
        }
      })
  }

  async readErd(erd: string): Promise<string> {
    const d = await axios.get(`/appliance/${this.accessory.context.device.applianceId}/erd/${erd}`)
    return String(d.data.value)
  }

  async writeErd(erd: string, value: string | boolean) {
    await axios.post(`/appliance/${this.accessory.context.device.applianceId}/erd/${erd}`, {
      kind: 'appliance#erdListEntry',
      userId: this.accessory.context.userId,
      applianceId: this.accessory.context.device.applianceId,
      erd,
      value: typeof value === 'boolean' ? (value ? '01' : '00') : value,
    })
    return undefined
  }
}
/*
function cToF(celsius: number) {
  return (celsius * 9) / 5 + 32
}
*/
function fToC(fahrenheit: number) {
  return ((fahrenheit - 32) * 5) / 9
}
