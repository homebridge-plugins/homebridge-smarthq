/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * oven.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { Buffer } from 'node:buffer'

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
          const r = await this.readErd(ERD_TYPES.UPPER_OVEN_LIGHT)
          return r ? Number.parseInt(r) !== 0 : false
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
          if (!erdVal) {
            return 0
          }
          const b = Buffer.from(erdVal, 'hex')
          return fToC(b.readUint16BE(1))
        } catch (error: any) {
          this.warnLog?.(`Oven Temperature error: ${error?.message ?? error}`)
          return 0
        }
      })

    // Probe Temperature Sensor (if available)
    ;(async () => {
      const probePresent = await this.has_erd_code(ERD_TYPES.UPPER_OVEN_PROBE_PRESENT)
      if (probePresent) {
        const probeTempSensor = this.accessory.getService('Probe Temperature') ?? this.accessory.addService(this.platform.Service.TemperatureSensor, 'Probe Temperature', 'ProbeTemp')
        probeTempSensor.setCharacteristic(this.platform.Characteristic.Name, 'Probe Temperature')
        probeTempSensor
          .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
          .onGet(async () => {
            const r = await this.readErd(ERD_TYPES.UPPER_OVEN_PROBE_DISPLAY_TEMP)
            if (!r) {
              return 0
            }
            const tempF = Number.parseInt(r)
            return fToC(tempF)
          })
      }
    })()

    // Cook Time Remaining (using a valve to show remaining duration)
    const cookTimeValve = this.accessory.getService('Cook Time') ?? this.accessory.addService(this.platform.Service.Valve, 'Cook Time', 'CookTime')
    cookTimeValve.setCharacteristic(this.platform.Characteristic.Name, 'Cook Time')
    cookTimeValve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)
    cookTimeValve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.UPPER_OVEN_COOK_TIME_REMAINING)
        // Active if time remaining is non-zero
        return r && Number.parseInt(r, 16) > 0
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE
      })

    cookTimeValve
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.UPPER_OVEN_COOK_TIME_REMAINING)
        return r && Number.parseInt(r, 16) > 0
          ? this.platform.Characteristic.InUse.IN_USE
          : this.platform.Characteristic.InUse.NOT_IN_USE
      })

    cookTimeValve
      .getCharacteristic(this.platform.Characteristic.RemainingDuration)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.UPPER_OVEN_COOK_TIME_REMAINING)
        if (!r) {
          return 0
        }
        // Cook time remaining is stored as minutes in hex, convert to seconds
        const minutes = Number.parseInt(r, 16)
        const seconds = minutes * 60
        this.debugLog(`Cook Time Remaining - Hex: ${r}, Minutes: ${minutes}, Seconds: ${seconds}`)
        return seconds
      })

    // Remote Enabled Status (binary sensor)
    const remoteEnabledSensor = this.accessory.getService('Remote Enabled') ?? this.accessory.addService(this.platform.Service.ContactSensor, 'Remote Enabled', 'RemoteEnabled')
    remoteEnabledSensor.setCharacteristic(this.platform.Characteristic.Name, 'Remote Enabled')
    remoteEnabledSensor
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.UPPER_OVEN_REMOTE_ENABLED)
        // 1=enabled (open/not detected), 0=disabled (closed/detected)
        return r && Number.parseInt(r) === 1
          ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
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
}
/*
function cToF(celsius: number) {
  return (celsius * 9) / 5 + 32
}
*/
function fToC(fahrenheit: number) {
  return ((fahrenheit - 32) * 5) / 9
}
