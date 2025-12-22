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
    accessory.context.device.features.forEach((feature) => {
      if (feature === 'COOKING_V1_UPPER_OVEN_FOUNDATION') {
        const ovenLight = this.accessory.getService(accessory.displayName) ?? this.accessory.addService(this.platform.Service.Lightbulb, accessory.displayName, 'Oven')
        ovenLight
          .getCharacteristic(this.platform.Characteristic.On)
          .onGet(async () => {
            try {
              return await this.readErd(ERD_TYPES.UPPER_OVEN_LIGHT).then(r => Number.parseInt(r) !== 0)
            } catch (error: any) {
              this.warnLog?.(`Oven handleGetOn error: ${error?.message ?? error}`)
              return false
            }
          })
          .onSet(async (value) => {
            try {
              await this.writeErd(ERD_TYPES.UPPER_OVEN_LIGHT, value as boolean)
            } catch (error: any) {
              this.warnLog?.(`Oven handleSetOn error: ${error?.message ?? error}`)
            }
          })
      } else if (feature === 'COOKING_V1_EXTENDED_COOKTOP_FOUNDATION') {
        this.accessory.getService(accessory.displayName) ?? this.accessory.addService(this.platform.Service.StatefulProgrammableSwitch, accessory.displayName, 'Oven')
          .getCharacteristic(this.platform.Characteristic.TargetTemperature)
          .onGet(async () => {
            try {
              const erdVal = await this.readErd(ERD_TYPES.UPPER_OVEN_COOK_MODE)
              const b = Buffer.from(erdVal, 'hex')
              return fToC(b.readUint16BE(1))
            } catch (error: any) {
              this.warnLog?.(`Oven handleGetTargetTemperature error: ${error?.message ?? error}`)
              return 0
            }
          })
          .onSet(async (value) => {
            try {
              const fTarget = cToF(value as number)
              const erdVal = await this.readErd(ERD_TYPES.UPPER_OVEN_COOK_MODE)
              const b = Buffer.from(erdVal, 'hex')
              b.writeUint16BE(fTarget, 1)
              return this.writeErd(ERD_TYPES.UPPER_OVEN_COOK_MODE, b.toString('hex'))
            } catch (error: any) {
              this.warnLog?.(`Oven handleSetTargetTemperature error: ${error?.message ?? error}`)
            }
          })
      } else {
        this.debugLog(`Feature not supported: ${feature}`)
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

function cToF(celsius: number) {
  return (celsius * 9) / 5 + 32
}

function fToC(fahrenheit: number) {
  return ((fahrenheit - 32) * 5) / 9
}
