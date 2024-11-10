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
    accessory.context.device.features.forEach((feature) => {
      /* [
      'COOKING_V1_ACCENT_LIGHTING',
      'COOKING_V1_EXTENDED_COOKTOP_FOUNDATION',
      'COOKING_V1_MENU_TREE',
      'COOKING_V1_UPPER_OVEN_FOUNDATION',
      'COOKING_V2_CLOCK_DISPLAY',
      'COOKING_V2_UPPER_CAVITY_REMOTE_PRECISION_COOK',
      ]; */

      switch (feature) {
        case 'COOKING_V1_UPPER_OVEN_FOUNDATION': {
          const ovenLight
            = this.accessory.getService('Upper Oven Light')
            || this.accessory.addService(this.platform.Service.Lightbulb, 'Upper Oven Light', 'Oven')

          ovenLight
            .getCharacteristic(this.platform.Characteristic.On)
            .onGet(() => this.readErd(ERD_TYPES.UPPER_OVEN_LIGHT).then(r => Number.parseInt(r) !== 0))
            .onSet(value => this.writeErd(ERD_TYPES.UPPER_OVEN_LIGHT, value as boolean))
          break
        }
        case 'COOKING_V1_EXTENDED_COOKTOP_FOUNDATION': {
          this.accessory.getService('Upper Oven Mode')
          || this.accessory
            .addService(this.platform.Service.StatefulProgrammableSwitch, 'Upper Oven Mode', 'Oven')
            .getCharacteristic(this.platform.Characteristic.TargetTemperature)
            .onGet(async () => {
              const erdVal = await this.readErd(ERD_TYPES.UPPER_OVEN_COOK_MODE)

              const b = Buffer.from(erdVal, 'hex')
              return fToC(b.readUint16BE(1))
            })
            .onSet(async (value) => {
              const fTarget = cToF(value as number)

              const erdVal = await this.readErd(ERD_TYPES.UPPER_OVEN_COOK_MODE)
              const b = Buffer.from(erdVal, 'hex')
              b.writeUint16BE(fTarget, 1)

              return this.writeErd(ERD_TYPES.UPPER_OVEN_COOK_MODE, b.toString('hex'))
            })
        }
      }
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

function cToF(celsius: number) {
  return (celsius * 9) / 5 + 32
}

function fToC(fahrenheit: number) {
  return ((fahrenheit - 32) * 5) / 9
}
