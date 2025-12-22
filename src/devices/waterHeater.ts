/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * waterHeater.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { deviceBase } from './device.js'

export class SmartHQWaterHeater extends deviceBase {
  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.debugLog(`Water Heater Features: ${JSON.stringify(accessory.context.device.features)}`)

    // Water Heater as Thermostat
    const heaterService = this.accessory.getService('Water Heater') ?? this.accessory.addService(this.platform.Service.Thermostat, 'Water Heater', 'WaterHeater')
    heaterService.setCharacteristic(this.platform.Characteristic.Name, 'Water Heater')

    heaterService
      .getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(async () => {
        try {
          // TODO: Implement heating state ERD
          return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
        } catch (error: any) {
          this.warnLog?.(`Water Heater State error: ${error?.message ?? error}`)
          return this.platform.Characteristic.CurrentHeatingCoolingState.OFF
        }
      })

    heaterService
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [this.platform.Characteristic.TargetHeatingCoolingState.OFF, this.platform.Characteristic.TargetHeatingCoolingState.HEAT],
      })
      .onGet(async () => {
        try {
          // TODO: Implement target state ERD
          return this.platform.Characteristic.TargetHeatingCoolingState.HEAT
        } catch (error: any) {
          this.warnLog?.(`Water Heater Target State error: ${error?.message ?? error}`)
          return this.platform.Characteristic.TargetHeatingCoolingState.OFF
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement target state control ERD
          this.debugLog(`Water Heater set to: ${value}`)
        } catch (error: any) {
          this.warnLog?.(`Water Heater Target State set error: ${error?.message ?? error}`)
        }
      })

    heaterService
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        try {
          // TODO: Implement current temperature ERD
          return 50
        } catch (error: any) {
          this.warnLog?.(`Water Heater Current Temp error: ${error?.message ?? error}`)
          return 50
        }
      })

    heaterService
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: 40,
        maxValue: 60,
        minStep: 1,
      })
      .onGet(async () => {
        try {
          // TODO: Implement target temperature ERD
          return 50
        } catch (error: any) {
          this.warnLog?.(`Water Heater Target Temp error: ${error?.message ?? error}`)
          return 50
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement target temperature control ERD
          this.debugLog(`Water Heater temperature set to: ${value}°C`)
        } catch (error: any) {
          this.warnLog?.(`Water Heater Target Temp set error: ${error?.message ?? error}`)
        }
      })

    heaterService
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(async () => this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS)
      .onSet(async (value) => {
        this.debugLog(`Water Heater display units set to: ${value}`)
      })
  }
}
