/*
 * airConditioner.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import axios from 'axios'
import { interval, startWith } from 'rxjs'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

enum PowerState {
  ON = '01',
  OFF = '00',
}

enum TemperatureUnit {
  FAHRENHEIT = '00',
  CELSIUS = '01',
}

enum FanSetting {
  AUTO = '01',
  LOW = '02',
  MED = '04',
  HIGH = '08',
}

enum FilterStatus {
  OK = '00',
  CLEAN = '01',
}

enum OperationMode {
  COOL = '00',
  FAN_ONLY = '01',
  ENERGY_SAVER = '02',
  DRY = '04',
}

export class SmartHQAirConditioner extends deviceBase {
  // HeaterCooler service
  private readonly HEATER_COOLER_SVC_NAME = 'AIR_CONDITIONER'
  private heaterCoolerSvc!: Service

  // Optional separate Fan service for fan-speed control
  private readonly FAN_SVC_NAME = 'AIR_CONDITIONER_FAN'
  private fanSvc?: Service

  // Mode SwitchServices
  private readonly MODE_SWITCH_SVC_PREFIX = 'AIR_CONDITIONER_MODE'
  private modeSwitchSvc!: Partial<Record<OperationMode, Service>>

  // TODO: Make supportsDryMode deterministic from reported appliance capabilities.
  private readonly supportsDryMode = false

  private readonly defaultOperationMode: OperationMode
  private readonly createSeparateFanService: boolean

  // Matter support override flag
  private useMatterOverride: boolean = false

  constructor(
    protected readonly platform: SmartHQPlatform,
    protected readonly accessory: PlatformAccessory<SmartHqContext>,
    protected readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    const airConditionerConfig = device as devicesConfig & {
      defaultOperationMode?: 'cool' | 'fanOnly' | 'energySaver' | 'dry'
      showDryModeSwitch?: boolean
      createSeparateFanService?: boolean
    }

    this.defaultOperationMode = {
      cool: OperationMode.COOL,
      fanOnly: OperationMode.FAN_ONLY,
      energySaver: OperationMode.ENERGY_SAVER,
      dry: OperationMode.DRY,
    }[airConditionerConfig.defaultOperationMode ?? 'energySaver']

    this.createSeparateFanService = airConditionerConfig.createSeparateFanService ?? true

    // Check if we should use Matter protocol
    this.useMatterOverride = device.useMatter ?? false

    this.debugLog(`Air Conditioner Features: ${JSON.stringify(accessory.context.device.features)}`)
    this.debugLog(`Using protocol: ${this.useMatterOverride ? 'Matter' : 'HAP'}`)

    // Initialize the appropriate protocol
    if (this.useMatterOverride) {
      this.initializeMatter().catch((error) => {
        this.errorLog(`Failed to initialize Matter: ${error}`)
      })
      // Still need to initialize switch services for compatibility
      this.modeSwitchSvc = {}
      return
    } else {
      this.initializeHAP()
    }

    // Start an update interval to refresh state
    interval(this.deviceRefreshRate * 1000)
      .pipe(startWith(0))
      .subscribe(this.refreshState.bind(this))
  }

  /**
   * Initialize Matter protocol
   */
    const { valid, api: matterAPI } = this.validateMatterAPI()

    if (!valid) {
      this.errorLog('Matter API not available or incomplete - falling back to HAP')
      this.initializeHAP()
      return
    }

    const serialNumber = this.device.applianceId || 'unknown'
    this.matterUuid = matterAPI.uuid.generate(serialNumber)

    // Create Matter accessory configuration with AC-specific clusters
      UUID: this.matterUuid,
      displayName: this.device.nickname || 'SmartHQ Air Conditioner',
      serialNumber,
      manufacturer: this.device.brand && this.device.brand !== 'Unknown' ? this.device.brand : 'GE Appliances',
      model: this.device.model || 'SmartHQ',
      firmwareRevision: this.deviceFirmwareVersion,
      hardwareRevision: this.deviceFirmwareVersion,
      deviceType: matterAPI.deviceTypes.AirConditioner,
        // On/Off cluster for power state
        onOff: {
          onOff: false,
        },
        // Thermostat cluster for temperature control
        thermostat: {
          localTemperature: 2200, // 22°C
          occupiedCoolingSetpoint: 2200,
          systemMode: 3, // COOL
          thermostatRunningMode: 3,
          controlSequenceOfOperation: 2, // cooling only
        },
        // Fan Control cluster
        fanControl: {
          fanMode: 0, // 0=Off, 1=Low, 2=Medium, 3=High, 4=Auto
          fanModeSequence: 4, // Support Off/Low/Med/High/Auto
          percentSetting: 0,
          percentCurrent: 0,
        },
        // Resource Monitoring for filter
        resourceMonitoring: {
          condition: 100, // 100% = OK, 0% = needs replacement
          degradationDirection: 1, // 1 = down (degrades over time)
          changeIndication: 0, // 0=OK, 1=Warning, 2=Critical
        },
        // Mode Select for operation modes
        modeSelect: {
          supportedModes: [
            { label: 'Cool', mode: 0 },
            { label: 'Fan Only', mode: 1 },
            { label: 'Energy Saver', mode: 2 },
            ...(this.supportsDryMode ? [{ label: 'Dry', mode: 3 }] : []),
          ],
          currentMode: 0,
        },
      },
      handlers: {
        onOff: {
          on: async () => {
            await this.setPowerState(PowerState.ON)
          },
          off: async () => {
            await this.setPowerState(PowerState.OFF)
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
    this.infoLog('Created Matter Air Conditioner with thermostat, fan control, mode selection, and filter monitoring clusters')
  }

  /**
   * Initialize HAP (HomeKit) protocol
   */
  private initializeHAP(): void {
    // HeaterCooler service
    this.heaterCoolerSvc = this.accessory!.getService(this.HEATER_COOLER_SVC_NAME)
      ?? this.accessory!.addService(
        this.platform.Service.HeaterCooler,
        this.accessory.displayName,
        this.HEATER_COOLER_SVC_NAME,
      )

    if (this.createSeparateFanService) {
      this.fanSvc = this.accessory.getService(this.FAN_SVC_NAME)
        ?? this.accessory.addService(
          this.platform.Service.Fanv2,
          `${this.accessory.displayName} Fan`,
          this.FAN_SVC_NAME,
        )

      this.heaterCoolerSvc.addLinkedService(this.fanSvc)
    } else {
      const existingFanService = this.accessory.getService(this.FAN_SVC_NAME)
      if (existingFanService) {
        this.accessory.removeService(existingFanService)
      }
    }

    this.modeSwitchSvc = {
      [OperationMode.COOL]: this.accessory.getService(`${this.MODE_SWITCH_SVC_PREFIX}_COOL`)
        ?? this.accessory.addService(this.platform.Service.Switch, `${this.accessory.displayName} Cool Mode`, `${this.MODE_SWITCH_SVC_PREFIX}_COOL`),
      [OperationMode.FAN_ONLY]: this.accessory.getService(`${this.MODE_SWITCH_SVC_PREFIX}_FAN_ONLY`)
        ?? this.accessory.addService(this.platform.Service.Switch, `${this.accessory.displayName} Fan Only Mode`, `${this.MODE_SWITCH_SVC_PREFIX}_FAN_ONLY`),
      [OperationMode.ENERGY_SAVER]: this.accessory.getService(`${this.MODE_SWITCH_SVC_PREFIX}_ENERGY_SAVER`)
        ?? this.accessory.addService(this.platform.Service.Switch, `${this.accessory.displayName} Energy Saver Mode`, `${this.MODE_SWITCH_SVC_PREFIX}_ENERGY_SAVER`),
    }

    if (this.supportsDryMode) {
      this.modeSwitchSvc[OperationMode.DRY] = this.accessory.getService(`${this.MODE_SWITCH_SVC_PREFIX}_DRY`)
        ?? this.accessory.addService(this.platform.Service.Switch, `${this.accessory.displayName} Dry Mode`, `${this.MODE_SWITCH_SVC_PREFIX}_DRY`)
    } else {
      const existingDryModeService = this.accessory.getService(`${this.MODE_SWITCH_SVC_PREFIX}_DRY`)
      if (existingDryModeService) {
        this.accessory.removeService(existingDryModeService)
      }
    }

    // Active
    this.heaterCoolerSvc
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.handleGetActive.bind(this))
      .onSet(this.handleSetActive.bind(this))

    // Current mode
    this.heaterCoolerSvc
      .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .setProps({
        validValues: [
          this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE,
          this.platform.Characteristic.CurrentHeaterCoolerState.IDLE,
          this.platform.Characteristic.CurrentHeaterCoolerState.COOLING,
        ],
      })
      .onGet(this.handleGetCurrentHeaterCoolerState.bind(this))

    // Target mode (COOL only)
    this.heaterCoolerSvc
      .getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .setProps({
        validValues: [
          this.platform.Characteristic.TargetHeaterCoolerState.COOL,
        ],
      })
      .onGet(this.handleGetTargetHeaterCoolerState.bind(this))
      .onSet(this.handleSetTargetHeaterCoolerState.bind(this))

    // Ambient temp
    this.heaterCoolerSvc
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleGetCurrentTemperature.bind(this))

    // Target temperature
    this.heaterCoolerSvc
      .getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .setProps({
        minValue: 17.7778, // 64F
        maxValue: 30, // 86F
      })
      .onGet(this.handleGetCoolingThresholdTemperature.bind(this))
      .onSet(this.handleSetCoolingThresholdTemperature.bind(this))

    // Rotation speed
    this.heaterCoolerSvc
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.handleGetRotationSpeed.bind(this))
      .onSet(this.handleSetRotationSpeed.bind(this))

    if (this.fanSvc) {
      this.fanSvc
        .getCharacteristic(this.platform.Characteristic.Active)
        .onGet(this.handleGetFanActive.bind(this))
        .onSet(this.handleSetFanActive.bind(this))

      this.fanSvc
        .getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
        .onGet(this.handleGetRotationSpeed.bind(this))
        .onSet(this.handleSetRotationSpeed.bind(this))
    }

    // Display units
    this.heaterCoolerSvc
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleGetTemperatureDisplayUnits.bind(this))
      .onSet(this.handleSetTemperatureDisplayUnits.bind(this))

    // Filter
    this.heaterCoolerSvc
      .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(this.handleGetFilterChangeIndication.bind(this))

    // Modes
    for (const mode of this.getSupportedOperationModes()) {
      const modeService = this.modeSwitchSvc[mode]
      if (!modeService) {
        continue
      }

      modeService
        .getCharacteristic(this.platform.Characteristic.On)
        .onGet(this.handleGetOperationMode.bind(this, mode))
        .onSet(this.handleSetOperationMode.bind(this, mode))

      modeService
        .getCharacteristic(this.platform.Characteristic.Name)
        .onGet(this.handleGetOperationModeName.bind(this, mode))
    }
  }

  // API

  private async getErdValue(erd: string): Promise<string> {
    const value = await this.readErd(erd)
    if (!value) {
      throw new Error(`Failed to fetch ERD ${erd}: No value returned`)
    }
    return value
  }

  private async setErdValue(erd: string, value: string): Promise<void> {
    try {
      await axios.post(`/appliance/${this.accessory.context.device.applianceId}/erd/${erd}`, {
        kind: 'appliance#erdListEntry',
        userId: this.accessory.context.userId,
        applianceId: this.accessory.context.device.applianceId,
        erd,
        value,
      })

      this.platform.log.debug(`[${this.accessory.displayName}] Set ERD ${erd}=${value}`)
    } catch (cause) {
      throw new Error(
        axios.isAxiosError(cause) && cause.response
          ? `Failed to set ERD ${erd}=${value}: ${cause.response.data.message}`
          : `Failed to set ERD ${erd}=${value}: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`,
        { cause },
      )
    }
  }

  private async getPowerState(): Promise<PowerState> {
    const erdValue = await this.getErdValue(ERD_TYPES.AIR_CONDITIONER_POWER_STATUS)

    return erdValue as PowerState
  }

  private async setPowerState(value: PowerState): Promise<void> {
    await this.setErdValue(ERD_TYPES.AIR_CONDITIONER_POWER_STATUS, value)

    this.platform.log.debug(`[${this.accessory.displayName}] Set power state to ${value}`)
  }

  private async getAmbientTemperature(): Promise<number> {
    try {
      const erdValue = await this.getErdValue(ERD_TYPES.AIR_CONDITIONER_AMBIENT_TEMPERATURE)
      const temperatureInFahrenheit = Number.parseInt(erdValue, 16) // erdValue is a hex string representing the temperature in Fahrenheit

      return this.fahrenheitToCelsius(temperatureInFahrenheit) // homekit expects Celsius
    } catch (cause) {
      throw new Error(`Failed to get current temperature: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
    }
  }

  private async getTemperature(): Promise<number> {
    try {
      const erdValue = await this.getErdValue(ERD_TYPES.AIR_CONDITIONER_TARGET_TEMPERATURE)
      const temperatureInFahrenheit = Number.parseInt(erdValue, 16) // erdValue is a hex string representing the temperature in Fahrenheit

      return this.fahrenheitToCelsius(temperatureInFahrenheit) // homekit expects Celsius
    } catch (cause) {
      throw new Error(`Failed to get target temperature: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
    }
  }

  private async setTemperature(value: number): Promise<void> {
    try {
      const temperatureInFahrenheit = this.celsiusToFahrenheit(value)
      const hexTemperature = Math.round(temperatureInFahrenheit).toString(16).padStart(4, '0').toUpperCase() // Convert to hex and ensure it's 4 characters long

      await this.setErdValue(ERD_TYPES.AIR_CONDITIONER_TARGET_TEMPERATURE, hexTemperature)

      this.platform.log.debug(`[${this.accessory.displayName}] Set temperature to ${value}°C (${temperatureInFahrenheit}°F)`)
    } catch (cause) {
      throw new Error(`Failed to set target temperature: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
    }
  }

  private async getTemperatureDisplayUnits(): Promise<TemperatureUnit> {
    try {
      const value = await this.getErdValue(ERD_TYPES.AIR_CONDITIONER_TEMPERATURE_UNIT)

      return value as TemperatureUnit
    } catch (cause) {
      throw new Error(`Failed to get temperature display units: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
    }
  }

  private async setTemperatureDisplayUnits(value: TemperatureUnit): Promise<void> {
    try {
      await this.setErdValue(ERD_TYPES.AIR_CONDITIONER_TEMPERATURE_UNIT, value)

      this.platform.log.debug(`[${this.accessory.displayName}] Set temperature display units to ${value}`)
    } catch (cause) {
      throw new Error(`Failed to set temperature display units: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
    }
  }

  private async getOperationMode(): Promise<OperationMode> {
    try {
      const value = await this.getErdValue(ERD_TYPES.AIR_CONDITIONER_OPERATION_MODE)

      return value as OperationMode
    } catch (cause) {
      throw new Error(`Failed to get operation mode: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
    }
  }

  private async setOperationMode(value: OperationMode): Promise<void> {
    try {
      await this.setErdValue(ERD_TYPES.AIR_CONDITIONER_OPERATION_MODE, value)

      this.platform.log.debug(`[${this.accessory.displayName}] Set operation mode to ${value}`)
    } catch (cause) {
      throw new Error(`Failed to set operation mode: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
    }
  }

  private async getFanSetting(): Promise<FanSetting> {
    try {
      const value = await this.getErdValue(ERD_TYPES.AIR_CONDITIONER_FAN_SETTING)

      return value as FanSetting
    } catch (cause) {
      throw new Error(`Failed to get fan setting: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
    }
  }

  private async setFanSetting(value: FanSetting): Promise<void> {
    try {
      await this.setErdValue(ERD_TYPES.AIR_CONDITIONER_FAN_SETTING, value)

      this.platform.log.debug(`[${this.accessory.displayName}] Set fan setting to ${value}`)
    } catch (cause) {
      throw new Error(`Failed to set fan setting: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
    }
  }

  private async getFilterStatus(): Promise<FilterStatus> {
    try {
      const value = await this.getErdValue(ERD_TYPES.AIR_CONDITIONER_FILTER_STATUS)

      return value as FilterStatus
    } catch (cause) {
      throw new Error(`Failed to get filter status: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
    }
  }

  // Characteristic handlers

  // active

  public async handleGetActive(): Promise<CharacteristicValue> {
    try {
      const powerState: PowerState = await this.getPowerState()

      return powerState === PowerState.ON
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE
    } catch (cause) {
      const error = new Error(`Failed to handle get active: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public async handleSetActive(value: CharacteristicValue): Promise<void> {
    try {
      const [powerState, ambientTemperature, targetTemperature] = await Promise.all([
        this.getPowerState(),
        this.getAmbientTemperature(),
        this.getTemperature(),
      ])

      if (value === this.platform.Characteristic.Active.ACTIVE) {
        // HomeKit exposes this service as Cool, but use the configured default
        // SmartHQ operating mode whenever the AC service is activated.
        if (powerState === PowerState.OFF) {
          await this.setPowerState(PowerState.ON)
        }

        await this.setOperationMode(this.defaultOperationMode)

        for (const mode of this.getSupportedOperationModes()) {
          this.modeSwitchSvc[mode]?.updateCharacteristic(
            this.platform.Characteristic.On,
            mode === this.defaultOperationMode,
          )
        }

        // Update CurrentHeaterCoolerState
        this.heaterCoolerSvc.updateCharacteristic(
          this.platform.Characteristic.CurrentHeaterCoolerState,
          ambientTemperature <= targetTemperature
            ? this.platform.Characteristic.CurrentHeaterCoolerState.IDLE
            : this.platform.Characteristic.CurrentHeaterCoolerState.COOLING,
        )

        this.fanSvc?.updateCharacteristic(
          this.platform.Characteristic.Active,
          await this.handleGetFanActive(),
        )

        return
      }

      if (powerState === PowerState.ON) {
        await this.setPowerState(PowerState.OFF)
      }

      // Keep mode switches in sync
      for (const mode of this.getSupportedOperationModes()) {
        this.modeSwitchSvc[mode]?.updateCharacteristic(
          this.platform.Characteristic.On,
          false,
        )
      }

      // Keep TargetHeaterCoolerState in sync
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.CurrentHeaterCoolerState,
        this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE,
      )

      this.fanSvc?.updateCharacteristic(
        this.platform.Characteristic.Active,
        this.platform.Characteristic.Active.INACTIVE,
      )
    } catch (cause) {
      const error = new Error(`Failed to handle set active: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public async handleGetCurrentHeaterCoolerState(): Promise<number> {
    try {
      const [powerState, ambientTemperature, targetTemperature] = await Promise.all([
        this.getPowerState(),
        this.getAmbientTemperature(),
        this.getTemperature(),
      ])

      if (powerState === PowerState.OFF) {
        return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE
      }

      if (ambientTemperature <= targetTemperature) {
        return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE
      }

      // Keep TargetHeaterCoolerState in sync
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.TargetHeaterCoolerState,
        this.platform.Characteristic.TargetHeaterCoolerState.COOL,
      )

      return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING
    } catch (cause) {
      const error = new Error(`Failed to handle get current heater cooler state: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public async handleGetTargetHeaterCoolerState(): Promise<CharacteristicValue> {
    try {
      // Cool is the only supported state for an air conditioner
      return this.platform.Characteristic.TargetHeaterCoolerState.COOL
    } catch (cause) {
      const error = new Error(`Failed to handle get target heater cooler state: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public async handleSetTargetHeaterCoolerState(_value: CharacteristicValue): Promise<void> {
    try {
      const powerState: PowerState = await this.getPowerState()

      // Turn on the air conditioner if it's currently off
      if (powerState === PowerState.OFF) {
        await this.setPowerState(PowerState.ON)
      }

      await this.setOperationMode(this.defaultOperationMode)

      for (const mode of this.getSupportedOperationModes()) {
        this.modeSwitchSvc[mode]?.updateCharacteristic(
          this.platform.Characteristic.On,
          mode === this.defaultOperationMode,
        )
      }

      // Keep CurrentHeaterCoolerState in sync with TargetHeaterCoolerState
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.CurrentHeaterCoolerState,
        this.platform.Characteristic.CurrentHeaterCoolerState.COOLING,
      )
    } catch (cause) {
      const error = new Error(`Failed to handle set target heater cooler state: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public async handleGetCurrentTemperature(): Promise<number> {
    try {
      const value: number = await this.getAmbientTemperature()

      return value
    } catch (cause) {
      const error = new Error(`Failed to handle get current temperature: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public async handleGetCoolingThresholdTemperature(): Promise<number> {
    try {
      const value: number = await this.getTemperature()

      return value
    } catch (cause) {
      const error = new Error(`Failed to handle get cooling threshold temperature: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public async handleSetCoolingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    try {
      const targetTemperature = Number.parseFloat(value as string)

      await this.setTemperature(targetTemperature)
    } catch (cause) {
      const error = new Error(`Failed to handle set cooling threshold temperature: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public async handleGetRotationSpeed(): Promise<CharacteristicValue> {
    try {
      const value: FanSetting = await this.getFanSetting()

      switch (value) {
        case FanSetting.AUTO:
          return 0
        case FanSetting.LOW:
          return 33
        case FanSetting.MED:
          return 66
        case FanSetting.HIGH:
          return 100
        default:
          throw new Error(`Unknown fan setting: ${value}`)
      }
    } catch (cause) {
      const error = new Error(`Failed to handle get fan setting: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public async handleGetFanActive(): Promise<CharacteristicValue> {
    try {
      const fanSetting = await this.getFanSetting()

      return fanSetting === FanSetting.AUTO
        ? this.platform.Characteristic.Active.INACTIVE
        : this.platform.Characteristic.Active.ACTIVE
    } catch (cause) {
      const error = new Error(`Failed to handle get fan active: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)
      throw error
    }
  }

  public async handleSetFanActive(value: CharacteristicValue): Promise<void> {
    try {
      if (value === this.platform.Characteristic.Active.ACTIVE) {
        const currentFanSetting = await this.getFanSetting()
        const nextFanSetting = currentFanSetting === FanSetting.AUTO
          ? FanSetting.LOW
          : currentFanSetting

        await this.setFanSetting(nextFanSetting)

        const displayedSpeed = nextFanSetting === FanSetting.LOW
          ? 33
          : nextFanSetting === FanSetting.MED
            ? 66
            : 100

        this.fanSvc?.updateCharacteristic(
          this.platform.Characteristic.Active,
          this.platform.Characteristic.Active.ACTIVE,
        )
        this.fanSvc?.updateCharacteristic(
          this.platform.Characteristic.RotationSpeed,
          displayedSpeed,
        )
        this.heaterCoolerSvc.updateCharacteristic(
          this.platform.Characteristic.RotationSpeed,
          displayedSpeed,
        )
        return
      }

      // Fan off / 0% maps to SmartHQ Auto and does not power off the AC.
      await this.setFanSetting(FanSetting.AUTO)
      this.fanSvc?.updateCharacteristic(
        this.platform.Characteristic.Active,
        this.platform.Characteristic.Active.INACTIVE,
      )
      this.fanSvc?.updateCharacteristic(
        this.platform.Characteristic.RotationSpeed,
        0,
      )
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.RotationSpeed,
        0,
      )
    } catch (cause) {
      const error = new Error(`Failed to handle set fan active: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)
      throw error
    }
  }

  public async handleSetRotationSpeed(value: CharacteristicValue): Promise<void> {
    try {
      const speed = value as number
      const fanSetting = speed === 0
        ? FanSetting.AUTO
        : speed <= 33
          ? FanSetting.LOW
          : speed <= 66
            ? FanSetting.MED
            : FanSetting.HIGH

      await this.setFanSetting(fanSetting)

      const displayedSpeed = fanSetting === FanSetting.AUTO
        ? 0
        : fanSetting === FanSetting.LOW
          ? 33
          : fanSetting === FanSetting.MED
            ? 66
            : 100

      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.RotationSpeed,
        displayedSpeed,
      )
      this.fanSvc?.updateCharacteristic(
        this.platform.Characteristic.RotationSpeed,
        displayedSpeed,
      )
      this.fanSvc?.updateCharacteristic(
        this.platform.Characteristic.Active,
        fanSetting === FanSetting.AUTO
          ? this.platform.Characteristic.Active.INACTIVE
          : this.platform.Characteristic.Active.ACTIVE,
      )
    } catch (cause) {
      const error = new Error(`Failed to handle set fan setting: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)
      throw error
    }
  }

  public async handleGetTemperatureDisplayUnits(): Promise<CharacteristicValue> {
    try {
      const value: TemperatureUnit = await this.getTemperatureDisplayUnits()

      return value === TemperatureUnit.FAHRENHEIT
        ? this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT
        : this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS
    } catch (cause) {
      const error = new Error(`Failed to handle get temperature display units: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public async handleSetTemperatureDisplayUnits(value: CharacteristicValue): Promise<void> {
    try {
      const temperatureUnit = value === this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT
        ? TemperatureUnit.FAHRENHEIT
        : TemperatureUnit.CELSIUS

      await this.setTemperatureDisplayUnits(temperatureUnit)
    } catch (cause) {
      const error = new Error(`Failed to handle set temperature display units: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public async handleGetFilterChangeIndication(): Promise<CharacteristicValue> {
    try {
      const value: FilterStatus = await this.getFilterStatus()

      return value === FilterStatus.OK
        ? this.platform.Characteristic.FilterChangeIndication.FILTER_OK
        : this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER
    } catch (cause) {
      const error = new Error(`Failed to handle get filter change indication: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public async handleGetOperationMode(mode: OperationMode): Promise<CharacteristicValue> {
    try {
      const [powerState, currentOperationMode] = await Promise.all([
        this.getPowerState(),
        this.getOperationMode(),
      ])

      // If the air conditioner is off, all modes are off
      if (powerState === PowerState.OFF) {
        return false
      }

      return currentOperationMode === mode
    } catch (cause) {
      const error = new Error(
        `Failed to handle get operation mode ${mode}: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`,
        { cause },
      )
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public async handleSetOperationMode(mode: OperationMode, value: CharacteristicValue): Promise<void> {
    try {
      const [powerState, currentOperationMode] = await Promise.all([
        this.getPowerState(),
        this.getOperationMode(),
      ])

      // turn on the Air Conditioner if it's currently off
      if (value && powerState === PowerState.OFF) {
        await this.setPowerState(PowerState.ON)

        // Keep Active in sync
        this.heaterCoolerSvc.updateCharacteristic(
          this.platform.Characteristic.Active,
          this.platform.Characteristic.Active.ACTIVE,
        )

        // Keep CurrentHeaterCoolerState in sync
        this.heaterCoolerSvc.updateCharacteristic(
          this.platform.Characteristic.CurrentHeaterCoolerState,
          this.platform.Characteristic.CurrentHeaterCoolerState.COOLING,
        )

        // Keep TargetHeaterCoolerState in sync
        this.heaterCoolerSvc.updateCharacteristic(
          this.platform.Characteristic.TargetHeaterCoolerState,
          this.platform.Characteristic.TargetHeaterCoolerState.COOL,
        )
      // turn off the Air Conditioner if the user turned off the current mode
      } else if (!value && currentOperationMode === mode && powerState === PowerState.ON) {
        await this.setPowerState(PowerState.OFF)

        // Keep Active in sync
        this.heaterCoolerSvc.updateCharacteristic(
          this.platform.Characteristic.Active,
          this.platform.Characteristic.Active.INACTIVE,
        )

        // Keep CurrentHeaterCoolerState in sync
        this.heaterCoolerSvc.updateCharacteristic(
          this.platform.Characteristic.CurrentHeaterCoolerState,
          this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE,
        )
      }

      if (value) {
        await this.setOperationMode(mode)
      }

      // switch the rest off
      for (const m of this.getSupportedOperationModes()) {
        this.modeSwitchSvc[m]?.updateCharacteristic(
          this.platform.Characteristic.On,
          Boolean(value) && m === mode,
        )
      }
    } catch (cause) {
      const error = new Error(
        `Failed to handle set operation mode ${mode}: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`,
        { cause },
      )
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  public handleGetOperationModeName(mode: OperationMode): string {
    try {
      switch (mode) {
        case OperationMode.COOL:
          return 'Cool Mode'
        case OperationMode.FAN_ONLY:
          return 'Fan Only Mode'
        case OperationMode.ENERGY_SAVER:
          return 'Energy Saver Mode'
        case OperationMode.DRY:
          return 'Dry Mode'
        default:
          throw new Error(`Unknown operation mode: ${mode}`)
      }
    } catch (cause) {
      const error = new Error(`Failed to handle get operation mode name for ${mode}: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  // Refresh state

  public async refreshState() {
    try {
      // active
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.Active,
        await this.handleGetActive(),
      )

      this.fanSvc?.updateCharacteristic(
        this.platform.Characteristic.Active,
        await this.handleGetFanActive(),
      )

      // Current mode
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.CurrentHeaterCoolerState,
        await this.handleGetCurrentHeaterCoolerState(),
      )

      // Target mode
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.TargetHeaterCoolerState,
        await this.handleGetTargetHeaterCoolerState(),
      )

      // Ambient temp
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        await this.handleGetCurrentTemperature(),
      )

      // Target temperature
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.CoolingThresholdTemperature,
        await this.handleGetCoolingThresholdTemperature(),
      )

      // Rotation speed
      const rotationSpeed = await this.handleGetRotationSpeed()
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.RotationSpeed,
        rotationSpeed,
      )
      this.fanSvc?.updateCharacteristic(
        this.platform.Characteristic.RotationSpeed,
        rotationSpeed,
      )

      // Display units
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.TemperatureDisplayUnits,
        await this.handleGetTemperatureDisplayUnits(),
      )

      // Filter
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.FilterChangeIndication,
        await this.handleGetFilterChangeIndication(),
      )

      // Modes
      for (const mode of this.getSupportedOperationModes()) {
        this.modeSwitchSvc[mode]?.updateCharacteristic(
          this.platform.Characteristic.On,
          await this.handleGetOperationMode(mode),
        )
      }

      this.platform.log.debug(`[${this.accessory.displayName}] Refreshed state`)
    } catch (cause) {
      const error = new Error(`Failed to refresh state for ${this.accessory.displayName}: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw error
    }
  }

  private getSupportedOperationModes(): OperationMode[] {
    return this.supportsDryMode
      ? [OperationMode.COOL, OperationMode.FAN_ONLY, OperationMode.ENERGY_SAVER, OperationMode.DRY]
      : [OperationMode.COOL, OperationMode.FAN_ONLY, OperationMode.ENERGY_SAVER]
  }

  // Helpers

  private fahrenheitToCelsius(fahrenheit: number): number {
    return (fahrenheit - 32) * 5 / 9
  }

  private celsiusToFahrenheit(celsius: number): number {
    return (celsius * 9 / 5) + 32
  }
}
