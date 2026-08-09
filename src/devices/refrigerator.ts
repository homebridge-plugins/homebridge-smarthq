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

// Services that were once attached to the Refrigerator accessory but
// have since been replaced or relocated. Removing them at startup cleans
// up Apple Home's cached view (which otherwise keeps showing the old
// tiles indefinitely).
const STALE_SERVICE_NAMES = [
  // Pre-beta-0.5.0 refactor leftovers
  'Refrigerator Door', // replaced by Fridge Right/Left Door + Freezer Door
  'Fridge Temperature', // replaced by Fridge thermostat
  'Freezer Temperature', // replaced by Freezer thermostat
  // Keurig services moved to a separate accessory so Apple Home / Siri
  // can address them cleanly without being lost among the fridge's
  // many services.
  'K-Cup Hot Water',
  'Hot Water Ready',
  'Hot Water Dispensing',
]

const FRIDGE_RANGE_F = { min: 34, max: 46 }
const FREEZER_RANGE_F = { min: -6, max: 8 }
const ERD_SIGNED_BYTE_RANGE_F = { min: -128, max: 127 }

// The API reports Fahrenheit regardless of TEMPERATURE_UNIT (0x0007), which only sets the front-panel display.
function fahrenheitToCelsius(f: number): number {
  return (f - 32) * 5 / 9
}

function toCentiCelsius(celsius: number): number {
  return Math.round(celsius * 100)
}

function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32
}

export function decodeCompartmentBytes(raw: string): { fridge: number, freezer: number } | undefined {
  const hex = raw.replace(/^0x/i, '')
  if (!/^[0-9a-f]{4}$/i.test(hex)) {
    return undefined
  }
  const signed = (byte: string): number => {
    const v = Number.parseInt(byte, 16)
    return v > 127 ? v - 256 : v
  }
  return { fridge: signed(hex.slice(0, 2)), freezer: signed(hex.slice(2, 4)) }
}

export function encodeCompartmentBytes(fridge: number, freezer: number): string {
  const byte = (v: number): string => {
    const clamped = Math.max(-128, Math.min(127, Math.round(v)))
    return ((clamped + 256) % 256).toString(16).padStart(2, '0').toUpperCase()
  }
  return `${byte(fridge)}${byte(freezer)}`
}

export function decodeCompartmentCelsius(
  raw: string | undefined,
  compartment: 'fridge' | 'freezer',
): { celsius: number, via: 'bytes' | 'object' | 'number' } | undefined {
  if (!raw || raw === 'undefined') {
    return
  }

  // Must precede JSON.parse: a pair like "2500" is also valid JSON and would otherwise decode as the number 2500.
  const bytes = decodeCompartmentBytes(raw)
  if (bytes) {
    return { celsius: fahrenheitToCelsius(bytes[compartment]), via: 'bytes' }
  }

  try {
    const parsed = JSON.parse(raw)

    if (parsed && typeof parsed === 'object' && parsed[compartment] !== undefined) {
      const num = Number(parsed[compartment])
      if (!Number.isNaN(num)) {
        return { celsius: fahrenheitToCelsius(num), via: 'object' }
      }
    }

    if (typeof parsed === 'number' || typeof parsed === 'string') {
      const num = Number(parsed)
      if (!Number.isNaN(num)) {
        return { celsius: fahrenheitToCelsius(num), via: 'number' }
      }
    }
  } catch {}
}

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

    const [fridgeTemp, freezerTemp, fridgeSetpoint] = await Promise.all([
      this.parseTemperature('fridge'),
      this.parseTemperature('freezer'),
      this.parseSetpoint('fridge'),
    ])

    const measured = (celsius: number | undefined): number | null => celsius === undefined ? null : toCentiCelsius(celsius)
    const setpoint = (celsius: number | undefined, fallbackF: number): number => toCentiCelsius(celsius ?? fahrenheitToCelsius(fallbackF))

    const measurableMin = toCentiCelsius(fahrenheitToCelsius(ERD_SIGNED_BYTE_RANGE_F.min))
    const measurableMax = toCentiCelsius(fahrenheitToCelsius(ERD_SIGNED_BYTE_RANGE_F.max))

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
          localTemperature: measured(fridgeTemp),
          occupiedCoolingSetpoint: setpoint(fridgeSetpoint, FRIDGE_RANGE_F.min),
          systemMode: 3, // COOL
          thermostatRunningMode: 3,
          controlSequenceOfOperation: 2, // cooling only
        },
        temperatureMeasurement: {
          measuredValue: measured(fridgeTemp),
          minMeasuredValue: measurableMin,
          maxMeasuredValue: measurableMax,
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
              measuredValue: measured(fridgeTemp),
              minMeasuredValue: measurableMin,
              maxMeasuredValue: measurableMax,
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
              measuredValue: measured(freezerTemp),
              minMeasuredValue: measurableMin,
              maxMeasuredValue: measurableMax,
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
        this.setServiceName(fridgeRightDoor, 'Fridge Right Door')
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
        this.setServiceName(fridgeLeftDoor, 'Fridge Left Door')
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
        this.setServiceName(freezerDoor, 'Freezer Door')
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
    this.setServiceName(fridgeIceBucket, 'Fridge Ice Bucket')
    fridgeIceBucket
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        const isFull = await parseIceBucketNibble(0)
        return isFull ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
      })

    // Freezer Ice Bucket (nibble 1)
    const freezerIceBucket = this.accessory!.getService('Freezer Ice Bucket') ?? this.accessory!.addService(this.platform.Service.ContactSensor, 'Freezer Ice Bucket', 'FreezerIceBucket')
    this.setServiceName(freezerIceBucket, 'Freezer Ice Bucket')
    freezerIceBucket
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        const isFull = await parseIceBucketNibble(1)
        return isFull ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
      })

    // Fridge Thermostat
    const fridgeThermostat = this.accessory!.getService('Fridge') ?? this.accessory!.addService(this.platform.Service.Thermostat, 'Fridge', 'FridgeThermostat')
    this.setServiceName(fridgeThermostat, 'Fridge')
    fridgeThermostat.setCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT)
    fridgeThermostat.setCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.platform.Characteristic.CurrentHeatingCoolingState.COOL)
    fridgeThermostat.setCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.platform.Characteristic.TargetHeatingCoolingState.COOL)
    fridgeThermostat
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: [this.platform.Characteristic.TargetHeatingCoolingState.COOL] })

    fridgeThermostat
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        return await this.parseTemperature('fridge') ?? fahrenheitToCelsius(FRIDGE_RANGE_F.min)
      })

    fridgeThermostat
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: fahrenheitToCelsius(FRIDGE_RANGE_F.min),
        maxValue: fahrenheitToCelsius(FRIDGE_RANGE_F.max),
        minStep: 0.5,
      })
      .onGet(async () => {
        return await this.parseSetpoint('fridge') ?? fahrenheitToCelsius(FRIDGE_RANGE_F.min)
      })
      .onSet(async (value) => {
        await this.writeSetpoint('fridge', value as number)
      })

    // Freezer Thermostat
    const freezerThermostat = this.accessory!.getService('Freezer') ?? this.accessory!.addService(this.platform.Service.Thermostat, 'Freezer', 'FreezerThermostat')
    this.setServiceName(freezerThermostat, 'Freezer')
    freezerThermostat.setCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT)
    freezerThermostat.setCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.platform.Characteristic.CurrentHeatingCoolingState.COOL)
    freezerThermostat.setCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.platform.Characteristic.TargetHeatingCoolingState.COOL)
    freezerThermostat
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: [this.platform.Characteristic.TargetHeatingCoolingState.COOL] })

    freezerThermostat
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        return await this.parseTemperature('freezer') ?? fahrenheitToCelsius(FREEZER_RANGE_F.min)
      })

    freezerThermostat
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: fahrenheitToCelsius(FREEZER_RANGE_F.min),
        maxValue: fahrenheitToCelsius(FREEZER_RANGE_F.max),
        minStep: 0.5,
      })
      .onGet(async () => {
        return await this.parseSetpoint('freezer') ?? fahrenheitToCelsius(FREEZER_RANGE_F.min)
      })
      .onSet(async (value) => {
        await this.writeSetpoint('freezer', value as number)
      })

    // Air Filter Maintenance
    const filterService = this.accessory!.getService('Air Filter') ?? this.accessory!.addService(this.platform.Service.FilterMaintenance, 'Air Filter', 'AirFilter')
    this.setServiceName(filterService, 'Air Filter')
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
    this.setServiceName(iceMakerService, 'Ice Maker')
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
    this.setServiceName(turboCoolService, 'Turbo Cool')
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
    this.setServiceName(turboFreezeService, 'Turbo Freeze')
    turboFreezeService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.TURBO_FREEZE_STATUS)
        return r ? Number.parseInt(r) !== 0 : false
      })
      .onSet(async (value) => {
        await this.writeErd(ERD_TYPES.TURBO_FREEZE_STATUS, value as boolean)
      })

    // Strip out any services that were attached to this accessory by
    // previous plugin versions but are no longer wired here (pre-beta
    // door/temperature placeholders + the Keurig services that moved to
    // their own accessory). Without this, Apple Home keeps showing the
    // stale tiles indefinitely.
    for (const name of STALE_SERVICE_NAMES) {
      const svc = this.accessory!.getService(name)
      if (svc) {
        this.accessory!.removeService(svc)
        this.debugLog(`Removed stale service from Refrigerator accessory: ${name}`)
      }
    }
  }

  private async decodeCompartmentTemperature(
    raw: string | undefined,
    compartment: 'fridge' | 'freezer',
    label: string,
  ): Promise<number | undefined> {
    const decoded = decodeCompartmentCelsius(raw, compartment)
    if (!decoded) {
      this.debugLog(`${compartment} ${label}: could not decode ${raw}`)
      return undefined
    }
    this.debugLog(`${compartment} ${label} (${decoded.via}): ${decoded.celsius.toFixed(1)}°C from ${raw}`)
    return decoded.celsius
  }

  /**
   * Shared helper: Parse temperature from ERD (works for both HAP and Matter)
   */
  private async parseTemperature(compartment: 'fridge' | 'freezer'): Promise<number | undefined> {
    const r = await this.readErd(ERD_TYPES.CURRENT_TEMPERATURE)
    this.debugLog(`Raw CURRENT_TEMPERATURE ERD response: ${r}`)

    const measured = await this.decodeCompartmentTemperature(r, compartment, 'temperature')
    if (measured !== undefined) {
      return measured
    }

    // Some models do not implement CURRENT_TEMPERATURE, leaving nothing to fall back on but the setpoint.
    const setpoint = await this.parseSetpoint(compartment)
    if (setpoint !== undefined) {
      this.debugLog(`${compartment} reports no measured temperature; showing the setpoint instead`)
    }
    return setpoint
  }

  /**
   * Shared helper: Parse setpoint from ERD
   */
  private async parseSetpoint(compartment: 'fridge' | 'freezer'): Promise<number | undefined> {
    const r = await this.readErd(ERD_TYPES.TEMPERATURE_SETTING)
    return this.decodeCompartmentTemperature(r, compartment, 'setpoint')
  }

  /**
   * Shared helper: Write setpoint to ERD
   */
  private async writeSetpoint(compartment: 'fridge' | 'freezer', temperature: number): Promise<void> {
    try {
      const current = await this.readErd(ERD_TYPES.TEMPERATURE_SETTING)
      const bytes = current ? decodeCompartmentBytes(current) : undefined
      if (!bytes) {
        await this.errorLog(`Refusing to write ${compartment} setpoint: TEMPERATURE_SETTING read back as ${current ?? 'undefined'}, not a byte pair`)
        return
      }

      const fahrenheit = Math.round(celsiusToFahrenheit(temperature))
      const next = { ...bytes, [compartment]: fahrenheit }
      const erdData = encodeCompartmentBytes(next.fridge, next.freezer)

      await this.successLog(`Setting ${compartment} to ${fahrenheit}°F (${temperature.toFixed(1)}°C) -> ${erdData}`)
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
            await this.debugLog('Matter accessory not yet registered, will retry on next refresh cycle')
          } else {
            await this.errorLog(`Failed to update Matter accessory state: ${error?.message ?? error}`)
          }
        }
      }

      // Push the same readings into HomeKit. Every update above sat inside the
      // Matter branch, so for a HAP user - the default - this poll made eight
      // requests per cycle and threw the answers away. Nothing was ever pushed, so
      // HomeKit sent no change notifications either: an automation on "when the
      // Freezer Door opens" could never fire, and the tiles only moved when the
      // Home app happened to ask.
      await this.updateHapCharacteristics({
        fridgeTemp,
        freezerTemp,
        fridgeSetpoint,
        freezerSetpoint,
        doorStatus,
        iceMakerStatus,
        turboCoolStatus,
        turboFreezeStatus,
        filterStatus,
      })

      this.SensorUpdateInProgress = false
    } catch (error: any) {
      this.SensorUpdateInProgress = false
      await this.errorLog(`Failed to refresh device status: ${error?.message ?? error}`)
    }
  }

  /**
   * Push a poll's readings into the HomeKit services, so tiles move on their own
   * and automations get the change notifications they need
   */
  private async updateHapCharacteristics(readings: {
    fridgeTemp?: number
    freezerTemp?: number
    fridgeSetpoint?: number
    freezerSetpoint?: number
    doorStatus?: string
    iceMakerStatus?: string
    turboCoolStatus?: string
    turboFreezeStatus?: string
    filterStatus?: string
  }): Promise<void> {
    const { Characteristic } = this.platform
    const set = (serviceName: string, characteristic: any, value: any) => {
      if (value === undefined) {
        return
      }
      this.accessory!.getService(serviceName)?.updateCharacteristic(characteristic, value)
    }

    set('Fridge', Characteristic.CurrentTemperature, readings.fridgeTemp)
    set('Fridge', Characteristic.TargetTemperature, readings.fridgeSetpoint)
    set('Freezer', Characteristic.CurrentTemperature, readings.freezerTemp)
    set('Freezer', Characteristic.TargetTemperature, readings.freezerSetpoint)

    // The door status is a hex string, one byte per door
    if (readings.doorStatus) {
      const raw = readings.doorStatus.replace(/^0x/i, '')
      const doorAt = (byteIndex: number) => {
        const byte = raw.slice(byteIndex * 2, byteIndex * 2 + 2)
        if (byte === '') {
          return undefined
        }
        return Number.parseInt(byte, 16) !== 0
          ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_DETECTED
      }
      set('Fridge Right Door', Characteristic.ContactSensorState, doorAt(0))
      set('Fridge Left Door', Characteristic.ContactSensorState, doorAt(1))
      set('Freezer Door', Characteristic.ContactSensorState, doorAt(2))
    }

    const onOff = (value?: string) => value === undefined ? undefined : Number.parseInt(value) !== 0
    set('Ice Maker', Characteristic.On, onOff(readings.iceMakerStatus))
    set('Turbo Cool', Characteristic.On, onOff(readings.turboCoolStatus))
    set('Turbo Freeze', Characteristic.On, onOff(readings.turboFreezeStatus))

    if (readings.filterStatus !== undefined) {
      set('Air Filter', Characteristic.FilterChangeIndication, Number.parseInt(readings.filterStatus) === 1
        ? Characteristic.FilterChangeIndication.CHANGE_FILTER
        : Characteristic.FilterChangeIndication.FILTER_OK)
    }
  }
}
