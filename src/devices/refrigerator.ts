/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * refrigeratorUnified.ts: @homebridge-plugins/homebridge-smarthq - Unified HAP/Matter implementation.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { interval, skipWhile } from 'rxjs'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

/**
 * SmartHQ Refrigerator - Unified HAP/Matter Implementation
 * Supports both HomeKit Accessory Protocol and Matter protocol
 */
export class SmartHQRefrigerator extends deviceBase {
  // Updates
  SensorUpdateInProgress!: boolean
  deviceStatus: any

  // Matter support override flag
  private useMatterOverride: boolean = false

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    // Check if we should use Matter protocol
    this.useMatterOverride = device.useMatter ?? false

    this.debugLog(`Refrigerator Features: ${JSON.stringify(accessory.context.device.features)}`)
    this.debugLog(`Using protocol: ${this.useMatterOverride ? 'Matter' : 'HAP'}`)

    // Initialize the appropriate protocol
    if (this.useMatterOverride) {
      this.initializeMatter().catch((error) => {
        this.errorLog(`Failed to initialize Matter: ${error}`)
      })
    } else {
      this.initializeHAP()
    }

    // Start periodic refresh
    this.SensorUpdateInProgress = false
    interval(this.deviceRefreshRate * 1000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(async () => {
        await this.refreshDeviceStatus()
      })

    // Initial refresh - wait longer for Matter registration if using Matter
    const initialRefreshDelay = this.useMatterOverride ? 5000 : 2000
    setTimeout(() => this.refreshDeviceStatus(), initialRefreshDelay)
  }

  /**
   * Initialize Matter protocol
   */
  private async initializeMatter(): Promise<void> {
    const { valid, api: matterAPI } = this.validateMatterAPI()

    if (!valid) {
      if (this.device.matterOnly) {
        this.errorLog('Matter API not available or incomplete - accessory will NOT be published (matterOnly mode enabled)')
        this.errorLog('Reason: Matter API validation failed')
        return
      }
      this.errorLog('Matter API not available or incomplete - falling back to HAP')
      this.initializeHAP()
      return
    }

    // Check if RefrigeratorFreezer device type is available
    if (!matterAPI.deviceTypes.RefrigeratorFreezer) {
      if (this.device.matterOnly) {
        this.errorLog('Matter RefrigeratorFreezer device type not available - accessory will NOT be published (matterOnly mode enabled)')
        this.errorLog('Reason: Required Matter device type "RefrigeratorFreezer" is not available in this Homebridge version')
        this.errorLog(`Available Matter device types: ${Object.keys(matterAPI.deviceTypes).join(', ')}`)
        return
      }
      this.warnLog('Matter RefrigeratorFreezer device type not available in this Homebridge version - falling back to HAP')
      this.warnLog(`Available Matter device types: ${Object.keys(matterAPI.deviceTypes).join(', ')}`)
      this.useMatterOverride = false
      this.initializeHAP()
      return
    }

    const serialNumber = this.device.applianceId || 'unknown'
    this.matterUuid = matterAPI.uuid.generate(serialNumber)

    // Create Matter accessory configuration with refrigerator-specific clusters
    const matterAccessory = {
      UUID: this.matterUuid,
      displayName: this.device.nickname || 'SmartHQ Refrigerator',
      serialNumber,
      manufacturer: this.device.brand && this.device.brand !== 'Unknown' ? this.device.brand : 'GE Appliances',
      model: this.device.model || 'SmartHQ',
      firmwareRevision: this.deviceFirmwareVersion,
      hardwareRevision: this.deviceFirmwareVersion,
      deviceType: matterAPI.deviceTypes.RefrigeratorFreezer,
      clusters: {
        // Temperature control for main compartment
        thermostat: {
          localTemperature: 400, // 4°C in 0.01°C units
          occupiedCoolingSetpoint: 400,
          systemMode: 3, // COOL
          thermostatRunningMode: 3,
          controlSequenceOfOperation: 2, // cooling only
        },
        temperatureMeasurement: {
          measuredValue: 400, // 4°C
          minMeasuredValue: 0, // 0°C
          maxMeasuredValue: 720, // 7.2°C
        },
        // Refrigerator and Temperature Controlled Cabinet Mode Cluster (0x0052)
        refrigeratorAndTemperatureControlledCabinetMode: {
          mode: 0, // 0=Normal, 1=RapidCool, 2=RapidFreeze
        },
        // Refrigerator Alarm Cluster (0x0057)
        refrigeratorAlarm: {
          mask: 0, // Bitmap: bit 0=door open, bit 1=temp high, bit 2=temp low
          state: 0, // Current alarm state
          supported: 7, // Support door, temp high, temp low alarms
        },
      },
      // Multi-endpoint structure for fridge and freezer compartments
      parts: [
        // Fridge compartment endpoint
        {
          UUID: matterAPI.uuid.generate(`${serialNumber}-fridge`),
          displayName: 'Fridge Compartment',
          serialNumber: `${serialNumber}-fridge`,
          manufacturer: this.device.brand || 'GE Appliances',
          model: `${this.device.model || 'SmartHQ'} Fridge`,
          deviceType: matterAPI.deviceTypes.TemperatureSensor,
          clusters: {
            temperatureMeasurement: {
              measuredValue: 400, // 4°C
              minMeasuredValue: 0,
              maxMeasuredValue: 720,
            },
            // Boolean state for ice maker
            booleanState: {
              stateValue: false, // Ice maker state
            },
            // Resource monitoring for water filter
            resourceMonitoring: {
              condition: 100, // 100% = OK, 0% = needs replacement
              degradationDirection: 1, // 1 = down (degrades over time)
              changeIndication: 0, // 0=OK, 1=Warning, 2=Critical
              productIdentifierType: 0, // 0=UPC, 1=GTIN8, 2=EAN, 3=GTIN14
              productIdentifierValue: 'FILTER',
            },
          },
        },
        // Freezer compartment endpoint
        {
          UUID: matterAPI.uuid.generate(`${serialNumber}-freezer`),
          displayName: 'Freezer Compartment',
          serialNumber: `${serialNumber}-freezer`,
          manufacturer: this.device.brand || 'GE Appliances',
          model: `${this.device.model || 'SmartHQ'} Freezer`,
          deviceType: matterAPI.deviceTypes.TemperatureSensor,
          clusters: {
            temperatureMeasurement: {
              measuredValue: -1800, // -18°C
              minMeasuredValue: -2100,
              maxMeasuredValue: -330,
            },
            // Boolean state for turbo freeze
            booleanState: {
              stateValue: false, // Turbo freeze state
            },
          },
        },
      ],
      handlers: {
        thermostat: {
          setpointRaiseLower: async (request: any) => {
            await this.handleMatterSetpointChange(request)
          },
        },
        refrigeratorAndTemperatureControlledCabinetMode: {
          changeToMode: async (request: any) => {
            await this.handleMatterModeChange(request)
          },
        },
      },
    }

    // Register Matter accessory as external device
    await matterAPI.registerPlatformAccessories(
      '@homebridge-plugins/homebridge-smarthq',
      'SmartHQ',
      [matterAccessory],
    )
    this.matterRegistered = true
    this.infoLog('Created Matter Refrigerator with advanced clusters and multi-endpoint structure')
  }

  /**
   * Initialize HAP (HomeKit) protocol
   */
  private initializeHAP(): void {
    // Helper functions for parsing ERD values
    const checkDoorAvailability = async () => {
      const r = await this.readErd(ERD_TYPES.DOOR_STATUS)
      if (!r || r.length < 2) {
        return { byte0: false, byte1: false, byte2: false }
      }

      try {
        const byte0 = r.substring(0, 2)
        const byte1 = r.substring(2, 4)
        const byte2 = r.substring(4, 6)

        this.debugLog(`Door status bytes: byte0=${byte0}, byte1=${byte1}, byte2=${byte2}`)

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

    const parseDoorByte = async (byteIndex: 0 | 1 | 2): Promise<boolean> => {
      const r = await this.readErd(ERD_TYPES.DOOR_STATUS)
      if (!r) {
        return false
      }

      try {
        const byteValue = r.substring(byteIndex * 2, byteIndex * 2 + 2)
        const state = Number.parseInt(byteValue, 16)
        this.debugLog(`Door byte${byteIndex} value: ${byteValue} = ${state}`)
        return state !== 0
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
        const fridgeRightDoor = this.accessory!.getService('Fridge Right Door') ?? this.accessory!.addService(this.platform.Service.ContactSensor, 'Fridge Right Door', 'FridgeRightDoor')
        fridgeRightDoor.setCharacteristic(this.platform.Characteristic.Name, 'Fridge Right Door')
        fridgeRightDoor
          .getCharacteristic(this.platform.Characteristic.ContactSensorState)
          .onGet(async () => {
            const isOpen = await parseDoorByte(0)
            return isOpen ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
          })
      }

      // Byte 1: Fridge Left Door
      if (availableDoors.byte1) {
        const fridgeLeftDoor = this.accessory!.getService('Fridge Left Door') ?? this.accessory!.addService(this.platform.Service.ContactSensor, 'Fridge Left Door', 'FridgeLeftDoor')
        fridgeLeftDoor.setCharacteristic(this.platform.Characteristic.Name, 'Fridge Left Door')
        fridgeLeftDoor
          .getCharacteristic(this.platform.Characteristic.ContactSensorState)
          .onGet(async () => {
            const isOpen = await parseDoorByte(1)
            return isOpen ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
          })
      }

      // Byte 2: Freezer Door
      if (availableDoors.byte2) {
        const freezerDoor = this.accessory!.getService('Freezer Door') ?? this.accessory!.addService(this.platform.Service.ContactSensor, 'Freezer Door', 'FreezerDoor')
        freezerDoor.setCharacteristic(this.platform.Characteristic.Name, 'Freezer Door')
        freezerDoor
          .getCharacteristic(this.platform.Characteristic.ContactSensorState)
          .onGet(async () => {
            const isOpen = await parseDoorByte(2)
            return isOpen ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
          })
      }
    })()

    // Ice Bucket Status helpers
    const parseIceBucketNibble = async (nibbleIndex: 0 | 1): Promise<boolean> => {
      const r = await this.readErd(ERD_TYPES.ICE_MAKER_BUCKET_STATUS)
      if (!r || r.length < 2) {
        return false
      }

      try {
        const nibbleValue = nibbleIndex === 0 ? r.charAt(0) : r.charAt(1)
        const status = Number.parseInt(nibbleValue, 16)
        this.debugLog(`Ice bucket nibble${nibbleIndex} value: ${nibbleValue} = ${status}`)
        return status >= 2
      } catch (parseError) {
        this.debugLog(`Ice bucket nibble${nibbleIndex} parse error: ${parseError}`)
        return false
      }
    }

    // Fridge Ice Bucket (nibble 0)
    const fridgeIceBucket = this.accessory!.getService('Fridge Ice Bucket') ?? this.accessory!.addService(this.platform.Service.ContactSensor, 'Fridge Ice Bucket', 'FridgeIceBucket')
    fridgeIceBucket.setCharacteristic(this.platform.Characteristic.Name, 'Fridge Ice Bucket')
    fridgeIceBucket
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        const isFull = await parseIceBucketNibble(0)
        return isFull ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
      })

    // Freezer Ice Bucket (nibble 1)
    const freezerIceBucket = this.accessory!.getService('Freezer Ice Bucket') ?? this.accessory!.addService(this.platform.Service.ContactSensor, 'Freezer Ice Bucket', 'FreezerIceBucket')
    freezerIceBucket.setCharacteristic(this.platform.Characteristic.Name, 'Freezer Ice Bucket')
    freezerIceBucket
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        const isFull = await parseIceBucketNibble(1)
        return isFull ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
      })

    // Fridge Thermostat
    const fridgeThermostat = this.accessory!.getService('Fridge') ?? this.accessory!.addService(this.platform.Service.Thermostat, 'Fridge', 'FridgeThermostat')
    fridgeThermostat.setCharacteristic(this.platform.Characteristic.Name, 'Fridge')
    fridgeThermostat.setCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT)
    fridgeThermostat.setCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.platform.Characteristic.CurrentHeatingCoolingState.COOL)
    fridgeThermostat.setCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.platform.Characteristic.TargetHeatingCoolingState.COOL)
    fridgeThermostat
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: [this.platform.Characteristic.TargetHeatingCoolingState.COOL] })

    fridgeThermostat
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        const temp = await this.parseTemperature('fridge')
        return temp ?? 4.0
      })

    fridgeThermostat
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({ minValue: 0, maxValue: 7.2, minStep: 0.5 })
      .onGet(async () => {
        const temp = await this.parseSetpoint('fridge')
        return temp ?? 4.0
      })
      .onSet(async (value) => {
        await this.writeSetpoint('fridge', value as number)
      })

    // Freezer Thermostat
    const freezerThermostat = this.accessory!.getService('Freezer') ?? this.accessory!.addService(this.platform.Service.Thermostat, 'Freezer', 'FreezerThermostat')
    freezerThermostat.setCharacteristic(this.platform.Characteristic.Name, 'Freezer')
    freezerThermostat.setCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT)
    freezerThermostat.setCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.platform.Characteristic.CurrentHeatingCoolingState.COOL)
    freezerThermostat.setCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.platform.Characteristic.TargetHeatingCoolingState.COOL)
    freezerThermostat
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: [this.platform.Characteristic.TargetHeatingCoolingState.COOL] })

    freezerThermostat
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        const temp = await this.parseTemperature('freezer')
        return temp ?? -18.0
      })

    freezerThermostat
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({ minValue: -21, maxValue: -3.3, minStep: 0.5 })
      .onGet(async () => {
        const temp = await this.parseSetpoint('freezer')
        return temp ?? -18.0
      })
      .onSet(async (value) => {
        await this.writeSetpoint('freezer', value as number)
      })

    // Air Filter Maintenance
    const filterService = this.accessory!.getService('Air Filter') ?? this.accessory!.addService(this.platform.Service.FilterMaintenance, 'Air Filter', 'AirFilter')
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

    // Ice Maker Control
    const iceMakerService = this.accessory!.getService('Ice Maker') ?? this.accessory!.addService(this.platform.Service.Switch, 'Ice Maker', 'IceMaker')
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
    const turboCoolService = this.accessory!.getService('Turbo Cool') ?? this.accessory!.addService(this.platform.Service.Switch, 'Turbo Cool', 'TurboCool')
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
    const turboFreezeService = this.accessory!.getService('Turbo Freeze') ?? this.accessory!.addService(this.platform.Service.Switch, 'Turbo Freeze', 'TurboFreeze')
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
  }

  /**
   * Shared helper: Parse temperature from ERD (works for both HAP and Matter)
   */
  private async parseTemperature(compartment: 'fridge' | 'freezer'): Promise<number | undefined> {
    const r = await this.readErd(ERD_TYPES.CURRENT_TEMPERATURE)
    this.debugLog(`Raw CURRENT_TEMPERATURE ERD response: ${r}`)

    if (!r || r === 'undefined') {
      return undefined
    }

    try {
      const parsed = JSON.parse(r)

      // Case 1: ERD returns an object with compartment keys, e.g. { "fridge": 4, "freezer": -18 }
      if (parsed && typeof parsed === 'object' && parsed[compartment] !== undefined) {
        const tempCelsius = Number(parsed[compartment])
        this.debugLog(`${compartment} temperature (object): ${tempCelsius}°C`)
        return tempCelsius
      }

      // Case 2: ERD returns a raw numeric value (often in centi-degrees), e.g. 2500 -> 25.00°C
      if (typeof parsed === 'number' || typeof parsed === 'string') {
        const num = Number(parsed)
        if (!Number.isNaN(num)) {
          // Heuristic: values >= 100 likely represent centi-degrees (e.g. 2500 => 25.00°C)
          const tempCelsius = Math.abs(num) >= 100 ? num / 100 : num
          this.debugLog(`${compartment} temperature (raw): ${tempCelsius}°C from ${num}`)
          return tempCelsius
        }
      }
    } catch (parseError) {
      this.debugLog(`Temperature parse error: ${parseError}`)
    }

    // Case 3: Some appliances return hex byte pairs (fridge+freezer) like "0A14" or "0000FF".
    // Decode hex pairs into signed bytes (compatible with simbaja/gehome FridgeSetPointsConverter).
    try {
      const hex = r.replace(/^0x/, '')
      if (/^[0-9a-f]+$/i.test(hex) && hex.length >= 4) {
        const fridgeHex = hex.substring(0, 2)
        const freezerHex = hex.substring(2, 4)
        const fridgeVal = Number.parseInt(fridgeHex, 16)
        const freezerVal = Number.parseInt(freezerHex, 16)
        const fridgeSigned = fridgeVal > 128 ? fridgeVal - 256 : fridgeVal
        const freezerSigned = freezerVal > 128 ? freezerVal - 256 : freezerVal
        const value = compartment === 'fridge' ? fridgeSigned : freezerSigned
        this.debugLog(`${compartment} temperature (hex bytes): ${value}° from ${hex}`)
        return value
      }
    } catch (hexError) {
      this.debugLog(`Temperature hex-parse error: ${hexError}`)
    }

    return undefined
  }

  /**
   * Shared helper: Parse setpoint from ERD
   */
  private async parseSetpoint(compartment: 'fridge' | 'freezer'): Promise<number | undefined> {
    const r = await this.readErd(ERD_TYPES.TEMPERATURE_SETTING)
    if (!r || r === 'undefined') {
      return undefined
    }

    try {
      const parsed = JSON.parse(r)

      // Case 1: object with compartment keys
      if (parsed && typeof parsed === 'object' && parsed[compartment] !== undefined) {
        const tempCelsius = Number(parsed[compartment])
        this.debugLog(`${compartment} setpoint (object): ${tempCelsius}°C`)
        return tempCelsius
      }

      // Case 2: raw numeric setpoint (often centi-degrees)
      if (typeof parsed === 'number' || typeof parsed === 'string') {
        const num = Number(parsed)
        if (!Number.isNaN(num)) {
          const tempCelsius = Math.abs(num) >= 100 ? num / 100 : num
          this.debugLog(`${compartment} setpoint (raw): ${tempCelsius}°C from ${num}`)
          return tempCelsius
        }
      }
    } catch (parseError) {
      this.debugLog(`Setpoint parse error: ${parseError}`)
    }

    // Case 3: hex byte-pair encoding like "0A14" or "2500" (hex). Decode similarly to gehome.
    try {
      const hex = r.replace(/^0x/, '')
      if (/^[0-9a-f]+$/i.test(hex) && hex.length >= 4) {
        const fridgeHex = hex.substring(0, 2)
        const freezerHex = hex.substring(2, 4)
        const fridgeVal = Number.parseInt(fridgeHex, 16)
        const freezerVal = Number.parseInt(freezerHex, 16)
        const fridgeSigned = fridgeVal > 128 ? fridgeVal - 256 : fridgeVal
        const freezerSigned = freezerVal > 128 ? freezerVal - 256 : freezerVal
        const value = compartment === 'fridge' ? fridgeSigned : freezerSigned
        this.debugLog(`${compartment} setpoint (hex bytes): ${value}° from ${hex}`)
        return value
      }
    } catch (hexError) {
      this.debugLog(`Setpoint hex-parse error: ${hexError}`)
    }

    return undefined
  }

  /**
   * Shared helper: Write setpoint to ERD
   */
  private async writeSetpoint(compartment: 'fridge' | 'freezer', temperature: number): Promise<void> {
    try {
      // Decide whether the appliance expects an object like { "fridge": 4 }
      // or a raw numeric value (commonly centi-degrees like 2500 => 25.00°C).
      const current = await this.readErd(ERD_TYPES.TEMPERATURE_SETTING)
      let erdData: string

      if (current) {
        try {
          const parsed = JSON.parse(current)
          if (parsed && typeof parsed === 'object' && parsed[compartment] !== undefined) {
            const value = Math.round(temperature).toString()
            erdData = JSON.stringify({ [compartment]: value })
            await this.successLog(`Writing setpoint as object for ${compartment}: ${erdData}`)
          } else {
            const centi = Math.round(temperature * 100)
            erdData = String(centi)
            await this.successLog(`Writing setpoint as raw centi-degrees for ${compartment}: ${erdData}`)
          }
        } catch (parseError) {
          // If parsing fails, fall back to a heuristic: if the raw current value looks numeric, send centi-degrees
          if (/^-?\d+$/.test(current)) {
            const centi = Math.round(temperature * 100)
            erdData = String(centi)
            await this.successLog(`Writing setpoint (fallback numeric) for ${compartment}: ${erdData}`)
          } else {
            const value = Math.round(temperature).toString()
            erdData = JSON.stringify({ [compartment]: value })
            await this.successLog(`Writing setpoint (fallback object) for ${compartment}: ${erdData}`)
          }
        }
      } else {
        // No current value available; default to object format to preserve previous behavior
        const value = Math.round(temperature).toString()
        erdData = JSON.stringify({ [compartment]: value })
        await this.successLog(`Writing setpoint (default object) for ${compartment}: ${erdData}`)
      }

      await this.writeErd(ERD_TYPES.TEMPERATURE_SETTING, erdData)
    } catch (error: any) {
      await this.errorLog(`Failed to write ${compartment} setpoint: ${error?.message ?? error}`)
    }
  }

  /**
   * Handle Matter setpoint change
   */
  private async handleMatterSetpointChange(request: any): Promise<void> {
    try {
      const amount = request.amount as number
      const currentSetpoint = await this.parseSetpoint('fridge') ?? 4

      const newSetpoint = currentSetpoint + (amount / 10)
      await this.infoLog(`Matter setpoint adjust: ${amount * 0.1}°C (${currentSetpoint}°C -> ${newSetpoint}°C)`)

      await this.writeSetpoint('fridge', newSetpoint)
    } catch (error: any) {
      await this.errorLog(`Failed to adjust Matter setpoint: ${error?.message ?? error}`)
    }
  }

  /**
   * Handle Matter mode change (Normal, Rapid Cool, Rapid Freeze)
   */
  private async handleMatterModeChange(request: any): Promise<void> {
    try {
      const newMode = request.newMode as number
      await this.infoLog(`Matter mode change to: ${newMode === 0 ? 'Normal' : newMode === 1 ? 'Rapid Cool' : 'Rapid Freeze'}`)

      // Map Matter modes to SmartHQ ERD codes
      if (newMode === 1) {
        // Rapid Cool - enable Turbo Cool
        await this.writeErd(ERD_TYPES.TURBO_COOL_STATUS, true)
        await this.writeErd(ERD_TYPES.TURBO_FREEZE_STATUS, false)
      } else if (newMode === 2) {
        // Rapid Freeze - enable Turbo Freeze
        await this.writeErd(ERD_TYPES.TURBO_COOL_STATUS, false)
        await this.writeErd(ERD_TYPES.TURBO_FREEZE_STATUS, true)
      } else {
        // Normal - disable both
        await this.writeErd(ERD_TYPES.TURBO_COOL_STATUS, false)
        await this.writeErd(ERD_TYPES.TURBO_FREEZE_STATUS, false)
      }

      // Update the mode cluster
      if (this.matterUuid && this.matterRegistered) {
        const matterAPI = (this.api as any).matter
        await matterAPI.updateAccessoryState(
          this.matterUuid,
          'refrigeratorAndTemperatureControlledCabinetMode',
          { mode: newMode },
        )
      }
    } catch (error: any) {
      await this.errorLog(`Failed to change Matter mode: ${error?.message ?? error}`)
    }
  }

  /**
   * Refresh device status - update both HAP and Matter states
   */
  private async refreshDeviceStatus(): Promise<void> {
    try {
      this.SensorUpdateInProgress = true

      // Get temperatures
      const fridgeTemp = await this.parseTemperature('fridge')
      const freezerTemp = await this.parseTemperature('freezer')

      // Get setpoints
      const fridgeSetpoint = await this.parseSetpoint('fridge')
      const freezerSetpoint = await this.parseSetpoint('freezer')

      // Get door status for alarm cluster
      const doorStatus = await this.readErd(ERD_TYPES.DOOR_STATUS)

      // Get ice maker status
      const iceMakerStatus = await this.readErd(ERD_TYPES.ICE_MAKER_CONTROL)

      // Get turbo cool/freeze status for mode cluster
      const turboCoolStatus = await this.readErd(ERD_TYPES.TURBO_COOL_STATUS)
      const turboFreezeStatus = await this.readErd(ERD_TYPES.TURBO_FREEZE_STATUS)

      // Get filter status for resource monitoring
      const filterStatus = await this.readErd(ERD_TYPES.AIR_FILTER_STATUS)

      // Update Matter state if using Matter
      if (this.useMatterOverride && this.matterUuid && this.matterRegistered) {
        try {
          const matterAPI = (this.api as any).matter

          // Update fridge values
          if (fridgeTemp !== undefined) {
            await matterAPI.updateAccessoryState(
              this.matterUuid,
              matterAPI.clusterNames.Thermostat,
              { localTemperature: Math.round(fridgeTemp * 100) },
            )
            await matterAPI.updateAccessoryState(
              this.matterUuid,
              'temperatureMeasurement',
              { measuredValue: Math.round(fridgeTemp * 100) },
            )
          }
          // Update fridge setpoint
          if (fridgeSetpoint !== undefined) {
            await matterAPI.updateAccessoryState(
              this.matterUuid,
              matterAPI.clusterNames.Thermostat,
              { occupiedCoolingSetpoint: Math.round(fridgeSetpoint * 100) },
            )
          }
          // Update freezer values
          if (freezerTemp !== undefined) {
            await matterAPI.updateAccessoryState(
              this.matterUuid,
              matterAPI.clusterNames.Thermostat,
              { localTemperature: Math.round(freezerTemp * 100) },
            )
          }
          // Update freezer setpoint
          if (freezerSetpoint !== undefined) {
            await matterAPI.updateAccessoryState(
              this.matterUuid,
              matterAPI.clusterNames.Thermostat,
              { occupiedCoolingSetpoint: Math.round(freezerSetpoint * 100) },
            )
          }

          // Update refrigerator mode cluster based on turbo status
          let currentMode = 0 // Normal
          if (turboCoolStatus && Number.parseInt(turboCoolStatus) !== 0) {
            currentMode = 1 // Rapid Cool
          } else if (turboFreezeStatus && Number.parseInt(turboFreezeStatus) !== 0) {
            currentMode = 2 // Rapid Freeze
          }
          await matterAPI.updateAccessoryState(
            this.matterUuid,
            'refrigeratorAndTemperatureControlledCabinetMode',
            { mode: currentMode },
          )

          // Update refrigerator alarm cluster
          let alarmState = 0
          if (doorStatus) {
          // Check if any door is open (non-zero value)
            const byte0 = doorStatus.substring(0, 2)
            const byte1 = doorStatus.substring(2, 4)
            const byte2 = doorStatus.substring(4, 6)
            if (byte0 !== '00' || byte1 !== '00' || byte2 !== '00') {
              alarmState |= 1 // Set door open alarm bit
            }
          }
          await matterAPI.updateAccessoryState(
            this.matterUuid,
            'refrigeratorAlarm',
            { state: alarmState },
          )

          // Update fridge compartment endpoint
          const fridgeEndpointUuid = matterAPI.uuid.generate(`${this.device.applianceId}-fridge`)
          if (fridgeTemp !== undefined) {
            await matterAPI.updateAccessoryState(
              fridgeEndpointUuid,
              'temperatureMeasurement',
              { measuredValue: Math.round(fridgeTemp * 100) },
            )
          }

          // Update fridge ice maker boolean state
          if (iceMakerStatus) {
            await matterAPI.updateAccessoryState(
              fridgeEndpointUuid,
              'booleanState',
              { stateValue: Number.parseInt(iceMakerStatus) !== 0 },
            )
          }

          // Update fridge filter resource monitoring
          if (filterStatus) {
            const needsReplacement = Number.parseInt(filterStatus) === 1
            await matterAPI.updateAccessoryState(
              fridgeEndpointUuid,
              'resourceMonitoring',
              {
                condition: needsReplacement ? 0 : 100,
                changeIndication: needsReplacement ? 2 : 0, // 2=Critical, 0=OK
              },
            )
          }

          // Update freezer compartment endpoint
          const freezerEndpointUuid = matterAPI.uuid.generate(`${this.device.applianceId}-freezer`)
          if (freezerTemp !== undefined) {
            await matterAPI.updateAccessoryState(
              freezerEndpointUuid,
              'temperatureMeasurement',
              { measuredValue: Math.round(freezerTemp * 100) },
            )
          }

          // Update freezer turbo freeze boolean state
          if (turboFreezeStatus) {
            await matterAPI.updateAccessoryState(
              freezerEndpointUuid,
              'booleanState',
              { stateValue: Number.parseInt(turboFreezeStatus) !== 0 },
            )
          }
        } catch (error: any) {
          // Matter updates failed, but this is recoverable - log and continue
          // Suppress "not found or not registered" errors as they're expected during startup
          if (error?.message?.includes('not found or not registered')) {
            await this.debugLog(`Matter accessory not yet registered, will retry on next refresh cycle`)
          } else {
            await this.errorLog(`Failed to update Matter accessory state: ${error?.message ?? error}`)
          }
        }
      }

      this.SensorUpdateInProgress = false
    } catch (error: any) {
      this.SensorUpdateInProgress = false
      await this.errorLog(`Failed to refresh device status: ${error?.message ?? error}`)
    }
  }
}
