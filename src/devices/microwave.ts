/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * microwave.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { deviceBase } from './device.js'

export class SmartHQMicrowave extends deviceBase {
  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.debugLog(`Microwave Features: ${JSON.stringify(accessory.context.device.features)}`)

    // Microwave Light
    const light = this.accessory.getService('Microwave Light') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'Microwave Light', 'MicrowaveLight')
    light.setCharacteristic(this.platform.Characteristic.Name, 'Microwave Light')
    light
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        try {
          // TODO: Implement light state ERD
          return false
        } catch (error: any) {
          this.warnLog?.(`Microwave Light error: ${error?.message ?? error}`)
          return false
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement light control ERD
          this.debugLog(`Microwave Light set to: ${value}`)
        } catch (error: any) {
          this.warnLog?.(`Microwave Light set error: ${error?.message ?? error}`)
        }
      })

    // Microwave Running State (Switch)
    const runningSwitch = this.accessory.getService('Microwave') ?? this.accessory.addService(this.platform.Service.Switch, 'Microwave', 'Microwave')
    runningSwitch.setCharacteristic(this.platform.Characteristic.Name, 'Microwave')
    runningSwitch
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        try {
          // TODO: Implement running state ERD
          return false
        } catch (error: any) {
          this.warnLog?.(`Microwave Running error: ${error?.message ?? error}`)
          return false
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement running control ERD
          this.debugLog(`Microwave Running set to: ${value}`)
        } catch (error: any) {
          this.warnLog?.(`Microwave Running set error: ${error?.message ?? error}`)
        }
      })

    // Ventilation Fan (if applicable)
    const fan = this.accessory.getService('Microwave Fan') ?? this.accessory.addService(this.platform.Service.Fanv2, 'Microwave Fan', 'MicrowaveFan')
    fan.setCharacteristic(this.platform.Characteristic.Name, 'Microwave Fan')
    fan
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        try {
          // TODO: Implement fan state ERD
          return this.platform.Characteristic.Active.INACTIVE
        } catch (error: any) {
          this.warnLog?.(`Microwave Fan error: ${error?.message ?? error}`)
          return this.platform.Characteristic.Active.INACTIVE
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement fan control ERD
          this.debugLog(`Microwave Fan set to: ${value}`)
        } catch (error: any) {
          this.warnLog?.(`Microwave Fan set error: ${error?.message ?? error}`)
        }
      })
  }
}
