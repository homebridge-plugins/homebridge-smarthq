/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * advantium.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { deviceBase } from './device.js'

export class SmartHQAdvantium extends deviceBase {
  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.debugLog(`Advantium Features: ${JSON.stringify(accessory.context.device.features)}`)

    // Advantium Light
    const light = this.accessory.getService('Advantium Light') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'Advantium Light', 'AdvantiumLight')
    light.setCharacteristic(this.platform.Characteristic.Name, 'Advantium Light')
    light
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        try {
          // TODO: Implement light state ERD
          return false
        } catch (error: any) {
          this.warnLog?.(`Advantium Light error: ${error?.message ?? error}`)
          return false
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement light control ERD
          this.debugLog(`Advantium Light set to: ${value}`)
        } catch (error: any) {
          this.warnLog?.(`Advantium Light set error: ${error?.message ?? error}`)
        }
      })

    // Advantium Temperature Sensor
    const tempSensor = this.accessory.getService('Advantium Temperature') ?? this.accessory.addService(this.platform.Service.TemperatureSensor, 'Advantium Temperature', 'AdvantiumTemp')
    tempSensor.setCharacteristic(this.platform.Characteristic.Name, 'Advantium Temperature')
    tempSensor
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        try {
          // TODO: Implement current temperature ERD
          return 0
        } catch (error: any) {
          this.warnLog?.(`Advantium Temperature error: ${error?.message ?? error}`)
          return 0
        }
      })

    // Advantium Running State (Switch)
    const runningSwitch = this.accessory.getService('Advantium Running') ?? this.accessory.addService(this.platform.Service.Switch, 'Advantium Running', 'AdvantiumRunning')
    runningSwitch.setCharacteristic(this.platform.Characteristic.Name, 'Advantium Running')
    runningSwitch
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        try {
          // TODO: Implement running state ERD
          return false
        } catch (error: any) {
          this.warnLog?.(`Advantium Running error: ${error?.message ?? error}`)
          return false
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement running control ERD
          this.debugLog(`Advantium Running set to: ${value}`)
        } catch (error: any) {
          this.warnLog?.(`Advantium Running set error: ${error?.message ?? error}`)
        }
      })
  }
}
