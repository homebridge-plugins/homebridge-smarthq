/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * oven.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

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

    // DOOR_STATUS ERD returns hex string where each byte represents a door compartment
    // Format: "XXYYZZ..." where XX=byte0, YY=byte1, etc.
    // 0xFF = not available/unused, 0x00 = closed, 0x01 = open
    // Byte mapping for this fridge model:
    //   byte0 (pos 0-1) = Fridge Right Door
    //   byte1 (pos 2-3) = Fridge Left Door
    //   byte2 (pos 4-5) = Freezer Door
    //   byte3 (pos 6-7) = Unused (0xFF)

    // Check which door bytes are available (not 0xFF)
    const checkDoorAvailability = async () => {
      const r = await this.readErd(ERD_TYPES.DOOR_STATUS)
      if (!r || r.length < 2) {
        return { byte0: false, byte1: false, byte2: false }
      }

      try {
        // Parse hex bytes - each byte is 2 characters
        const byte0 = r.substring(0, 2)
        const byte1 = r.substring(2, 4)
        const byte2 = r.substring(4, 6)

        this.debugLog(`Door status bytes: byte0=${byte0}, byte1=${byte1}, byte2=${byte2}`)

        // A byte is available if it exists and isn't 0xFF (unused)
        return {
          byte0: byte0 !== 'FF' && byte0 !== '',
          byte1: byte1 !== 'FF' && byte1 !== '' && byte1 !== undefined,
          byte2: byte2 !== 'FF' && byte2 !== '' && byte2 !== undefined,
        }
      } catch (parseError) {
        this.debugLog(`Door availability check failed: ${parseError}`)
        return { byte0: false, byte1: false, byte2: false }
      }
    }

    // Helper to parse individual door byte
    const parseDoorByte = async (byteIndex: 0 | 1 | 2): Promise<boolean> => {
      const r = await this.readErd(ERD_TYPES.DOOR_STATUS)
      if (!r) {
        return false
      }

      try {
        const byteValue = r.substring(byteIndex * 2, byteIndex * 2 + 2)
        const state = Number.parseInt(byteValue, 16)
        this.debugLog(`Door byte${byteIndex} value: ${byteValue} = ${state}`)
        return state !== 0 // 0 = closed, anything else = open
      } catch (parseError) {
        this.debugLog(`Door byte${byteIndex} parse error: ${parseError}`)
        return false
      }
    }

    // Check which door sensors to create
    (async () => {
      const availableDoors = await checkDoorAvailability()

      // Byte 0: Fridge Right Door
      if (availableDoors.byte0) {
        const doorService = this.accessory.getService('Fridge Right Door') ?? this.accessory.addService(this.platform.Service.ContactSensor, 'Fridge Right Door', 'FridgeRightDoor')
        doorService.setCharacteristic(this.platform.Characteristic.Name, 'Fridge Right Door')
        doorService
          .getCharacteristic(this.platform.Characteristic.ContactSensorState)
          .onGet(async () => parseDoorByte(0))
      }

      // Byte 1: Fridge Left Door
      if (availableDoors.byte1) {
        const door2Service = this.accessory.getService('Fridge Left Door') ?? this.accessory.addService(this.platform.Service.ContactSensor, 'Fridge Left Door', 'FridgeLeftDoor')
        door2Service.setCharacteristic(this.platform.Characteristic.Name, 'Fridge Left Door')
        door2Service
          .getCharacteristic(this.platform.Characteristic.ContactSensorState)
          .onGet(async () => parseDoorByte(1))
      }

      // Byte 2: Freezer Door
      if (availableDoors.byte2) {
        const door3Service = this.accessory.getService('Freezer Door') ?? this.accessory.addService(this.platform.Service.ContactSensor, 'Freezer Door', 'FreezerDoor')
        door3Service.setCharacteristic(this.platform.Characteristic.Name, 'Freezer Door')
        door3Service
          .getCharacteristic(this.platform.Characteristic.ContactSensorState)
          .onGet(async () => parseDoorByte(2))
      }
    })()

    // Ice Bucket Status (Contact Sensors - "open" when full)
    // Format: "XY" where X=fridge ice maker, Y=freezer ice maker
    // Each nibble: 0=empty, 1=not full, 2=full, 3=full
    // "Open" state (CONTACT_NOT_DETECTED) = bucket is full

    // Helper to parse ice bucket nibble (half-byte)
    const parseIceBucketNibble = async (nibbleIndex: 0 | 1): Promise<boolean> => {
      const r = await this.readErd(ERD_TYPES.ICE_MAKER_BUCKET_STATUS)
      if (!r || r.length < 2) {
        return false // Not full
      }

      try {
        const nibble = r.charAt(nibbleIndex)
        const status = Number.parseInt(nibble, 16)
        const isFull = status >= 2
        this.debugLog(`Ice Bucket ${nibbleIndex === 0 ? 'Fridge' : 'Freezer'} status: ${nibble} (${status}) - ${isFull ? 'Full' : 'Not Full'}`)
        return isFull
      } catch (parseError) {
        this.debugLog(`Ice Bucket ${nibbleIndex} parse error: ${parseError}`)
        return false
      }
    }

    // Fridge Ice Bucket (nibble 0)
    const fridgeIceBucket = this.accessory.getService('Fridge Ice Bucket') ?? this.accessory.addService(this.platform.Service.ContactSensor, 'Fridge Ice Bucket', 'FridgeIceBucket')
    fridgeIceBucket.setCharacteristic(this.platform.Characteristic.Name, 'Fridge Ice Bucket')
    fridgeIceBucket
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        const isFull = await parseIceBucketNibble(0)
        return isFull
          ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED // Open = full
          : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED // Closed = not full
      })

    // Freezer Ice Bucket (nibble 1)
    const freezerIceBucket = this.accessory.getService('Freezer Ice Bucket') ?? this.accessory.addService(this.platform.Service.ContactSensor, 'Freezer Ice Bucket', 'FreezerIceBucket')
    freezerIceBucket.setCharacteristic(this.platform.Characteristic.Name, 'Freezer Ice Bucket')
    freezerIceBucket
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        const isFull = await parseIceBucketNibble(1)
        return isFull
          ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED // Open = full
          : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED // Closed = not full
      })

    // Fridge Thermostat (with temperature sensor and target temp control)
    const fridgeThermostat = this.accessory.getService('Fridge') ?? this.accessory.addService(this.platform.Service.Thermostat, 'Fridge', 'FridgeThermostat')
    fridgeThermostat.setCharacteristic(this.platform.Characteristic.Name, 'Fridge')
    fridgeThermostat.setCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT)
    fridgeThermostat.setCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.platform.Characteristic.CurrentHeatingCoolingState.COOL)
    fridgeThermostat.setCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.platform.Characteristic.TargetHeatingCoolingState.COOL)

    // Restrict to only COOL mode
    fridgeThermostat
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: [this.platform.Characteristic.TargetHeatingCoolingState.COOL] })

    fridgeThermostat
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.CURRENT_TEMPERATURE)
        this.debugLog(`Raw CURRENT_TEMPERATURE ERD response: ${r}`)

        if (!r || r === 'undefined') {
          return 2.8 // Default to ~37°F in Celsius
        }

        try {
          const temps = JSON.parse(r)
          const fridgeTempF = temps.fridge || temps.Fridge
          this.debugLog(`Fridge current temp: ${fridgeTempF}°F`)

          if (!fridgeTempF || Number.isNaN(Number(fridgeTempF))) {
            return 2.8
          }

          return (Number(fridgeTempF) - 32) * 5 / 9
        } catch (parseError) {
          this.debugLog(`Fridge Temperature: JSON parse error, using default`)
          return 2.8
        }
      })

    fridgeThermostat
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({ minValue: 0, maxValue: 7.2, minStep: 0.5 }) // 32°F to 45°F range
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.TEMPERATURE_SETTING)
        if (!r || r === 'undefined') {
          return 3.3 // Default to ~38°F
        }

        try {
          const setpoints = JSON.parse(r)
          const fridgeTargetF = setpoints.fridge || setpoints.Fridge
          this.debugLog(`Fridge target temp: ${fridgeTargetF}°F`)

          if (!fridgeTargetF || Number.isNaN(Number(fridgeTargetF))) {
            return 3.3
          }

          return (Number(fridgeTargetF) - 32) * 5 / 9
        } catch (parseError) {
          this.debugLog(`Fridge Target Temperature: JSON parse error, using default`)
          return 3.3
        }
      })
      .onSet(async (value) => {
        try {
          // Convert Celsius to Fahrenheit
          const targetF = Math.round((value as number) * 9 / 5 + 32)
          this.infoLog(`Setting Fridge target temperature to ${targetF}°F`)

          // Get current freezer setting to preserve it
          const currentSettings = await this.readErd(ERD_TYPES.TEMPERATURE_SETTING)
          let freezerTargetF = 0 // Default

          if (currentSettings && currentSettings !== 'undefined') {
            try {
              const setpoints = JSON.parse(currentSettings)
              freezerTargetF = setpoints.freezer || setpoints.Freezer || 0
            } catch {}
          }

          // Write both fridge and freezer settings
          const newSettings = JSON.stringify({ fridge: targetF, freezer: freezerTargetF })
          await this.writeErd(ERD_TYPES.TEMPERATURE_SETTING, newSettings)
        } catch (error: any) {
          this.warnLog?.(`Fridge set target temp error: ${error?.message ?? error}`)
        }
      })

    // Freezer Thermostat (with temperature sensor and target temp control)
    const freezerThermostat = this.accessory.getService('Freezer') ?? this.accessory.addService(this.platform.Service.Thermostat, 'Freezer', 'FreezerThermostat')
    freezerThermostat.setCharacteristic(this.platform.Characteristic.Name, 'Freezer')
    freezerThermostat.setCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT)
    freezerThermostat.setCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.platform.Characteristic.CurrentHeatingCoolingState.COOL)
    freezerThermostat.setCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.platform.Characteristic.TargetHeatingCoolingState.COOL)

    // Restrict to only COOL mode
    freezerThermostat
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: [this.platform.Characteristic.TargetHeatingCoolingState.COOL] })

    freezerThermostat
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.CURRENT_TEMPERATURE)
        this.debugLog(`Raw CURRENT_TEMPERATURE ERD response: ${r}`)

        if (!r || r === 'undefined') {
          return -17.8 // Default to ~0°F in Celsius
        }

        try {
          const temps = JSON.parse(r)
          const freezerTempF = temps.freezer || temps.Freezer
          this.debugLog(`Freezer current temp: ${freezerTempF}°F`)

          if (!freezerTempF || Number.isNaN(Number(freezerTempF))) {
            return -17.8
          }

          return (Number(freezerTempF) - 32) * 5 / 9
        } catch (parseError) {
          this.debugLog(`Freezer Temperature: JSON parse error, using default`)
          return -17.8
        }
      })

    freezerThermostat
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({ minValue: -21, maxValue: -3.3, minStep: 0.5 }) // -6°F to 26°F range
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.TEMPERATURE_SETTING)
        if (!r || r === 'undefined') {
          return -17.8 // Default to ~0°F
        }

        try {
          const setpoints = JSON.parse(r)
          const freezerTargetF = setpoints.freezer || setpoints.Freezer
          this.debugLog(`Freezer target temp: ${freezerTargetF}°F`)

          if (!freezerTargetF || Number.isNaN(Number(freezerTargetF))) {
            return -17.8
          }

          return (Number(freezerTargetF) - 32) * 5 / 9
        } catch (parseError) {
          this.debugLog(`Freezer Target Temperature: JSON parse error, using default`)
          return -17.8
        }
      })
      .onSet(async (value) => {
        try {
          // Convert Celsius to Fahrenheit
          const targetF = Math.round((value as number) * 9 / 5 + 32)
          this.infoLog(`Setting Freezer target temperature to ${targetF}°F`)

          // Get current fridge setting to preserve it
          const currentSettings = await this.readErd(ERD_TYPES.TEMPERATURE_SETTING)
          let fridgeTargetF = 37 // Default

          if (currentSettings && currentSettings !== 'undefined') {
            try {
              const setpoints = JSON.parse(currentSettings)
              fridgeTargetF = setpoints.fridge || setpoints.Fridge || 37
            } catch {}
          }

          // Write both fridge and freezer settings
          const newSettings = JSON.stringify({ fridge: fridgeTargetF, freezer: targetF })
          await this.writeErd(ERD_TYPES.TEMPERATURE_SETTING, newSettings)
        } catch (error: any) {
          this.warnLog?.(`Freezer set target temp error: ${error?.message ?? error}`)
        }
      })

    // Air Filter Maintenance
    const filterService = this.accessory.getService('Air Filter') ?? this.accessory.addService(this.platform.Service.FilterMaintenance, 'Air Filter', 'AirFilter')
    filterService.setCharacteristic(this.platform.Characteristic.Name, 'Air Filter')
    filterService
      .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.AIR_FILTER_STATUS)
        if (!r) {
          return this.platform.Characteristic.FilterChangeIndication.FILTER_OK
        }
        return Number.parseInt(r) === 1
          ? this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER
          : this.platform.Characteristic.FilterChangeIndication.FILTER_OK
      })

    // Ice Maker Control (Switch)
    const iceMakerService = this.accessory.getService('Ice Maker') ?? this.accessory.addService(this.platform.Service.Switch, 'Ice Maker', 'IceMaker')
    iceMakerService.setCharacteristic(this.platform.Characteristic.Name, 'Ice Maker')
    iceMakerService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.ICE_MAKER_CONTROL)
        return r ? Number.parseInt(r) !== 0 : false
      })
      .onSet(async (value) => {
        await this.writeErd(ERD_TYPES.ICE_MAKER_CONTROL, value as boolean)
      })

    // Turbo Cool Switch
    const turboCoolService = this.accessory.getService('Turbo Cool') ?? this.accessory.addService(this.platform.Service.Switch, 'Turbo Cool', 'TurboCool')
    turboCoolService.setCharacteristic(this.platform.Characteristic.Name, 'Turbo Cool')
    turboCoolService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.TURBO_COOL_STATUS)
        return r ? Number.parseInt(r) !== 0 : false
      })
      .onSet(async (value) => {
        await this.writeErd(ERD_TYPES.TURBO_COOL_STATUS, value as boolean)
      })

    // Turbo Freeze Switch
    const turboFreezeService = this.accessory.getService('Turbo Freeze') ?? this.accessory.addService(this.platform.Service.Switch, 'Turbo Freeze', 'TurboFreeze')
    turboFreezeService.setCharacteristic(this.platform.Characteristic.Name, 'Turbo Freeze')
    turboFreezeService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.TURBO_FREEZE_STATUS)
        return r ? Number.parseInt(r) !== 0 : false
      })
      .onSet(async (value) => {
        await this.writeErd(ERD_TYPES.TURBO_FREEZE_STATUS, value as boolean)
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
}
