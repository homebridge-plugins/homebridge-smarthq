/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * waterHeater.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { deviceBase } from './device.js'

export class SmartHQWaterHeater extends deviceBase {
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
    this.setServiceName(heaterService, 'Water Heater')

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
