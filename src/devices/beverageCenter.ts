/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * beverageCenter.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { deviceBase } from './device.js'

export class SmartHQBeverageCenter extends deviceBase {
  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.debugLog(`Beverage Center Features: ${JSON.stringify(accessory.context.device.features)}`)

    // Beverage Center Temperature Sensor
    const tempSensor = this.accessory!.getService('Beverage Temperature') ?? this.accessory!.addService(this.platform.Service.TemperatureSensor, 'Beverage Temperature', 'BeverageTemp')
    this.setServiceName(tempSensor, 'Beverage Temperature')
    tempSensor
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        try {
          // TODO: Implement current temperature ERD
          return 4
        } catch (error: any) {
          this.warnLog?.(`Beverage Center Temperature error: ${error?.message ?? error}`)
          return 4
        }
      })

    // Beverage Center Door Sensor
    const doorSensor = this.accessory!.getService('Beverage Door') ?? this.accessory!.addService(this.platform.Service.ContactSensor, 'Beverage Door', 'BeverageDoor')
    this.setServiceName(doorSensor, 'Beverage Door')
    doorSensor
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        try {
          // TODO: Implement door status ERD
          return this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
        } catch (error: any) {
          this.warnLog?.(`Beverage Center Door error: ${error?.message ?? error}`)
          return this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
        }
      })

    // Beverage Center Thermostat Control
    const thermostat = this.accessory!.getService('Beverage Thermostat') ?? this.accessory!.addService(this.platform.Service.Thermostat, 'Beverage Thermostat', 'BeverageThermostat')
    this.setServiceName(thermostat, 'Beverage Thermostat')
    thermostat
      .getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(async () => {
        try {
          // TODO: Implement cooling state ERD
          return this.platform.Characteristic.CurrentHeatingCoolingState.COOL
        } catch (error: any) {
          this.warnLog?.(`Beverage Center State error: ${error?.message ?? error}`)
          return this.platform.Characteristic.CurrentHeatingCoolingState.OFF
        }
      })

    thermostat
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [this.platform.Characteristic.TargetHeatingCoolingState.OFF, this.platform.Characteristic.TargetHeatingCoolingState.COOL],
      })
      .onGet(async () => {
        try {
          // TODO: Implement target state ERD
          return this.platform.Characteristic.TargetHeatingCoolingState.COOL
        } catch (error: any) {
          this.warnLog?.(`Beverage Center Target State error: ${error?.message ?? error}`)
          return this.platform.Characteristic.TargetHeatingCoolingState.OFF
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement target state control ERD
          this.debugLog(`Beverage Center set to: ${value}`)
        } catch (error: any) {
          this.warnLog?.(`Beverage Center Target State set error: ${error?.message ?? error}`)
        }
      })

    thermostat
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        try {
          // TODO: Implement current temperature ERD
          return 4
        } catch (error: any) {
          this.warnLog?.(`Beverage Center Current Temp error: ${error?.message ?? error}`)
          return 4
        }
      })

    thermostat
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: 2,
        maxValue: 8,
        minStep: 1,
      })
      .onGet(async () => {
        try {
          // TODO: Implement target temperature ERD
          return 4
        } catch (error: any) {
          this.warnLog?.(`Beverage Center Target Temp error: ${error?.message ?? error}`)
          return 4
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement target temperature control ERD
          this.debugLog(`Beverage Center temperature set to: ${value}°C`)
        } catch (error: any) {
          this.warnLog?.(`Beverage Center Target Temp set error: ${error?.message ?? error}`)
        }
      })

    thermostat
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(async () => this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS)
      .onSet(async (value) => {
        this.debugLog(`Beverage Center display units set to: ${value}`)
      })
  }
}
