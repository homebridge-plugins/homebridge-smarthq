/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * waterHeater.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

/**
 * The water heater reports temperatures in TENTHS of a degree, in the unit its
 * own panel is set to. Every reading seen so far is fahrenheit on a US model
 * (#117): setting the panel to 125 published `04E2` (1250) and setting it back
 * to 120 published `04B0` (1200).
 *
 * `UNIT_TYPE` (0x0035) is the ERD that would say a heater was in celsius; it is
 * deliberately not consulted yet, because nobody has produced a celsius
 * appliance to check its values against and a guess here reads as a fact later.
 *
 * Returns undefined for anything unparseable, so a caller can hold its previous
 * reading rather than publish a temperature nobody measured.
 */
export function waterHeaterTenthsToCelsius(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined
  }
  const tenths = Number.parseInt(raw, 16)
  if (!Number.isFinite(tenths)) {
    return undefined
  }
  const fahrenheit = tenths / 10
  return Math.round((((fahrenheit - 32) * 5) / 9) * 10) / 10
}

/**
 * The inverse, as the four hex digits the appliance expects.
 *
 * Rounded to a WHOLE degree fahrenheit first. HomeKit works in celsius and its
 * setpoint steps by one, so 51°C converts to 123.8°F - and the panel, which
 * only shows whole degrees, then read a degree lower than the one asked for
 * (#117). Rounding to the unit the appliance actually displays makes the two
 * agree, and makes the value stable when it is read back and written again.
 */
export function celsiusToWaterHeaterTenths(celsius: number): string {
  const fahrenheit = Math.round((celsius * 9) / 5 + 32)
  return (fahrenheit * 10).toString(16).toUpperCase().padStart(4, '0')
}

/**
 * The two modes a water heater offers. Its panel has no "off" - Vacation is as
 * close as it gets, and is what HomeKit's off maps onto (#117).
 */
export const WATER_HEATER_MODES = {
  NORMAL: '01',
  VACATION: '04',
} as const

export class SmartHQWaterHeater extends deviceBase {
  // Matter support override flag
  private useMatterOverride: boolean = false

  // Last real readings, so a failed fetch holds the previous number rather than
  // reporting a temperature the tank never saw
  private lastCurrentTempC: number | undefined
  private lastTargetTempC: number | undefined
  private heaterService: Service | undefined

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    // Check if we should use Matter protocol
    this.useMatterOverride = device.useMatter ?? false

    this.debugLog(`Water Heater Features: ${JSON.stringify(accessory.context.device.features)}`)
    this.debugLog(`Using protocol: ${this.useMatterOverride ? 'Matter' : 'HAP'}`)

    // Initialize the appropriate protocol
    if (this.useMatterOverride) {
      this.initializeMatter().catch((error) => {
        this.errorLog(`Failed to initialize Matter: ${error}`)
      })
    } else {
      this.initializeHAP()
    }
  }

  /**
   * Initialize Matter protocol
   */
  private async initializeMatter(): Promise<void> {
    const { valid, api: matterAPI } = this.validateMatterAPI()

    if (!valid) {
      this.errorLog('Matter API not available or incomplete - falling back to HAP')
      this.initializeHAP()
      return
    }

    const serialNumber = this.device.applianceId || 'unknown'
    this.matterUuid = matterAPI.uuid.generate(serialNumber)

    const matterAccessory = {
      UUID: this.matterUuid,
      displayName: this.device.nickname || 'SmartHQ Water Heater',
      serialNumber,
      manufacturer: this.device.brand && this.device.brand !== 'Unknown' ? this.device.brand : 'GE Appliances',
      model: this.device.model || 'SmartHQ',
      firmwareRevision: this.deviceFirmwareVersion,
      hardwareRevision: this.deviceFirmwareVersion,
      deviceType: matterAPI.deviceTypes.WaterHeater,
      clusters: {
        // Thermostat cluster for water temperature control
        thermostat: {
          localTemperature: 5500, // 55°C default
          occupiedHeatingSetpoint: 6000, // 60°C default
          systemMode: 4, // HEAT
          thermostatRunningMode: 4,
          controlSequenceOfOperation: 0, // heating only
        },
        // Temperature Measurement
        temperatureMeasurement: {
          measuredValue: 5500,
          minMeasuredValue: 3500, // 35°C
          maxMeasuredValue: 8000, // 80°C
        },
        // On/Off cluster for heater state
        onOff: {
          onOff: false,
        },
      },
      handlers: {},
    }

    await matterAPI.registerPlatformAccessories(
      '@homebridge-plugins/homebridge-smarthq',
      'SmartHQ',
      [matterAccessory],
    )
    this.matterRegistered = true
    this.infoLog('Registered Matter Water Heater as external accessory with thermostat and temperature measurement clusters')
  }

  /**
   * Initialize HAP (HomeKit) protocol
   */
  private initializeHAP(): void {
    // Water Heater as Thermostat
    const heaterService = this.accessory!.getService('Water Heater') ?? this.accessory!.addService(this.platform.Service.Thermostat, 'Water Heater', 'WaterHeater')
    this.heaterService = heaterService
    this.setServiceName(heaterService, 'Water Heater')

    heaterService
      .getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(async () => {
        try {
          const onVacation = await this.readErd(ERD_TYPES.WATER_HEATER_MODE) === WATER_HEATER_MODES.VACATION
          return onVacation
            ? this.platform.Characteristic.CurrentHeatingCoolingState.OFF
            : this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
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
          const onVacation = await this.readErd(ERD_TYPES.WATER_HEATER_MODE) === WATER_HEATER_MODES.VACATION
          return onVacation
            ? this.platform.Characteristic.TargetHeatingCoolingState.OFF
            : this.platform.Characteristic.TargetHeatingCoolingState.HEAT
        } catch (error: any) {
          this.warnLog?.(`Water Heater Target State error: ${error?.message ?? error}`)
          return this.platform.Characteristic.TargetHeatingCoolingState.OFF
        }
      })
      .onSet(async (value) => {
        try {
          // A water heater has no off. Vacation is the nearest thing its panel
          // offers, so that is what HomeKit's off asks for - worth knowing,
          // since a vacation is a fortnight by default on the appliance itself
          const mode = value === this.platform.Characteristic.TargetHeatingCoolingState.OFF
            ? WATER_HEATER_MODES.VACATION
            : WATER_HEATER_MODES.NORMAL
          await this.writeErd(ERD_TYPES.WATER_HEATER_MODE, mode)
          this.debugLog(`Water Heater set to: ${mode === WATER_HEATER_MODES.VACATION ? 'vacation' : 'normal'}`)
        } catch (error: any) {
          this.warnLog?.(`Water Heater Target State set error: ${error?.message ?? error}`)
        }
      })

    heaterService
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(async () => {
        try {
          const celsius = await this.readTemperatureC(ERD_TYPES.WATER_HEATER_CURRENT_TEMPERATURE)
          if (celsius === undefined) {
            return this.lastCurrentTempC ?? 50
          }
          this.lastCurrentTempC = celsius
          return celsius
        } catch (error: any) {
          this.warnLog?.(`Water Heater Current Temp error: ${error?.message ?? error}`)
          return this.lastCurrentTempC ?? 50
        }
      })

    heaterService
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        // Heat pump heaters go to 150F (65.5C) and their app lets owners set
        // it; capping HomeKit at 60 made every higher reading a characteristic
        // warning and hid the real setting (#126)
        minValue: 40,
        maxValue: 70,
        minStep: 1,
      })
      .onGet(async () => {
        try {
          const celsius = await this.readTemperatureC(ERD_TYPES.WATER_HEATER_TARGET_TEMPERATURE)
          if (celsius === undefined) {
            return this.lastTargetTempC ?? 50
          }
          this.lastTargetTempC = celsius
          return celsius
        } catch (error: any) {
          this.warnLog?.(`Water Heater Target Temp error: ${error?.message ?? error}`)
          return this.lastTargetTempC ?? 50
        }
      })
      .onSet(async (value) => {
        try {
          await this.writeErd(ERD_TYPES.WATER_HEATER_TARGET_TEMPERATURE, celsiusToWaterHeaterTenths(Number(value)))
          this.lastTargetTempC = Number(value)
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

  /**
   * Read a water heater temperature ERD and return it in celsius.
   *
   * The appliance reports these in TENTHS of a degree, in the unit its own
   * panel is set to. Every reading seen so far has been fahrenheit on a US
   * model (#117), which is what this assumes - `UNIT_TYPE` (0x0035) is the ERD
   * that would say otherwise, and is worth wiring in the moment a celsius
   * appliance turns up rather than guessing at its values now.
   *
   * Returns undefined when the appliance did not answer, so the caller can hold
   * its previous reading instead of publishing a temperature nobody measured.
   */
  private async readTemperatureC(erd: string): Promise<number | undefined> {
    const raw = await this.readErd(erd)
    if (!raw) {
      return undefined
    }

    const celsius = waterHeaterTenthsToCelsius(raw)
    if (celsius === undefined) {
      await this.warnLog(`Water Heater could not read ${erd} value [${raw}]`)
    }
    return celsius
  }

  /**
   * Push a temperature change straight to HomeKit.
   *
   * Without this the tile only refreshed when HomeKit happened to ask, so a
   * setpoint changed at the heater's own panel or in the SmartHQ app did not
   * show up in the Home app at all (#117). The platform has already cached the
   * new value by the time this runs, so the read helpers see it.
   */
  onErdUpdate(erd: string): void {
    void this.applyLiveUpdate(erd)
  }

  private async applyLiveUpdate(erd: string): Promise<void> {
    try {
      if (erd === ERD_TYPES.WATER_HEATER_CURRENT_TEMPERATURE) {
        const celsius = await this.readTemperatureC(ERD_TYPES.WATER_HEATER_CURRENT_TEMPERATURE)
        if (celsius !== undefined) {
          this.lastCurrentTempC = celsius
          this.heaterService?.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, celsius)
        }
      }

      if (erd === ERD_TYPES.WATER_HEATER_MODE) {
        const onVacation = await this.readErd(ERD_TYPES.WATER_HEATER_MODE) === WATER_HEATER_MODES.VACATION
        const state = onVacation
          ? this.platform.Characteristic.TargetHeatingCoolingState.OFF
          : this.platform.Characteristic.TargetHeatingCoolingState.HEAT
        this.heaterService?.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, state)
        this.heaterService?.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, state)
      }

      if (erd === ERD_TYPES.WATER_HEATER_TARGET_TEMPERATURE) {
        const celsius = await this.readTemperatureC(ERD_TYPES.WATER_HEATER_TARGET_TEMPERATURE)
        if (celsius !== undefined) {
          this.lastTargetTempC = celsius
          this.heaterService?.updateCharacteristic(this.platform.Characteristic.TargetTemperature, celsius)
        }
      }
    } catch (error: any) {
      this.warnLog?.(`Water Heater live update error: ${error?.message ?? error}`)
    }
  }
}
