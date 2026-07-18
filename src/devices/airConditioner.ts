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

enum AcSwingMode {
  DISABLED = '00',
  ENABLED = '01',
}

enum OperationMode {
  COOL = '00',
  FAN_ONLY = '01',
  ENERGY_SAVER = '02',
  HEAT = '03',
  DRY = '04',
}

export class SmartHQAirConditioner extends deviceBase {
  // HeaterCooler service
  private readonly HEATER_COOLER_SVC_NAME = 'AIR_CONDITIONER'
  private readonly heaterCoolerSvc!: Service

  // Optional separate Fan service for fan-speed control
  private readonly FAN_SVC_NAME = 'AIR_CONDITIONER_FAN'
  private fanSvc?: Service

  // Mode SwitchServices
  private readonly MODE_SWITCH_SVC_PREFIX = 'AIR_CONDITIONER_MODE'
  private readonly modeSwitchSvc: Partial<Record<OperationMode, Service>>

  // TODO: Make supportsDryMode deterministic from reported appliance capabilities.
  private readonly supportsDryMode = true
  private readonly showDryModeSwitch: boolean

  // Some models are cooling-only, so heat can be hidden from HomeKit (#73)
  private readonly showHeatMode: boolean
  private readonly showModeSwitches: boolean

  // Lazily flipped off when the appliance reports no swing mode ERD (#99)
  private swingModeSupported = true

  private readonly defaultOperationMode: OperationMode
  private readonly createSeparateFanService: boolean

  constructor(
    protected readonly platform: SmartHQPlatform,
    protected readonly accessory: PlatformAccessory<SmartHqContext>,
    protected readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    // Per-device config is looked up by applianceId as the device record passed
    // in does not carry the custom per-device properties
    const configuredDevices = (platform.config as { devices?: devicesConfig[] }).devices ?? []
    const airConditionerConfig = configuredDevices.find(config => config.applianceId === device.applianceId) ?? device

    this.showDryModeSwitch = airConditionerConfig.showDryModeSwitch ?? true
    this.showHeatMode = airConditionerConfig.showHeatMode ?? true
    this.showModeSwitches = airConditionerConfig.showModeSwitches ?? true

    const configuredDefaultOperationMode = {
      cool: OperationMode.COOL,
      fanOnly: OperationMode.FAN_ONLY,
      energySaver: OperationMode.ENERGY_SAVER,
      heat: OperationMode.HEAT,
      dry: OperationMode.DRY,
    }[airConditionerConfig.defaultOperationMode ?? 'cool'] ?? OperationMode.COOL

    const dryCoercedDefault = configuredDefaultOperationMode === OperationMode.DRY && !this.supportsDryMode
      ? OperationMode.ENERGY_SAVER
      : configuredDefaultOperationMode

    this.defaultOperationMode = dryCoercedDefault === OperationMode.HEAT && !this.showHeatMode
      ? OperationMode.COOL
      : dryCoercedDefault

    this.createSeparateFanService = airConditionerConfig.createSeparateFanService ?? false

    // HeaterCooler service
    this.heaterCoolerSvc = this.accessory.getService(this.HEATER_COOLER_SVC_NAME)
      ?? this.accessory.addService(
        this.platform.Service.HeaterCooler,
        accessory.displayName,
        this.HEATER_COOLER_SVC_NAME,
      )

    // Optional separate Fan service
    if (this.createSeparateFanService) {
      this.fanSvc = this.accessory.getService(this.FAN_SVC_NAME)
        ?? this.accessory.addService(
          this.platform.Service.Fanv2,
          `${accessory.displayName} Fan`,
          this.FAN_SVC_NAME,
        )

      this.heaterCoolerSvc.addLinkedService(this.fanSvc)
    } else {
      const existingFanService = this.accessory.getService(this.FAN_SVC_NAME)
      if (existingFanService) {
        this.accessory.removeService(existingFanService)
      }
    }

    // Mode SwitchServices: an opt-out for people who prefer a minimal tile
    // of just the mode selector and fan — note the switches are the only
    // HomeKit route into fan-only, dry and energy saver, as Apple's mode
    // selector cannot hold them (#76)
    this.modeSwitchSvc = {}
    if (this.showModeSwitches) {
      this.modeSwitchSvc[OperationMode.COOL] = this.accessory.getService(`${this.MODE_SWITCH_SVC_PREFIX}_COOL`)
        ?? this.accessory.addService(this.platform.Service.Switch, `${accessory.displayName} Cool Mode`, `${this.MODE_SWITCH_SVC_PREFIX}_COOL`)
      this.modeSwitchSvc[OperationMode.FAN_ONLY] = this.accessory.getService(`${this.MODE_SWITCH_SVC_PREFIX}_FAN_ONLY`)
        ?? this.accessory.addService(this.platform.Service.Switch, `${accessory.displayName} Fan Only Mode`, `${this.MODE_SWITCH_SVC_PREFIX}_FAN_ONLY`)
      this.modeSwitchSvc[OperationMode.ENERGY_SAVER] = this.accessory.getService(`${this.MODE_SWITCH_SVC_PREFIX}_ENERGY_SAVER`)
        ?? this.accessory.addService(this.platform.Service.Switch, `${accessory.displayName} Energy Saver Mode`, `${this.MODE_SWITCH_SVC_PREFIX}_ENERGY_SAVER`)
    }

    if (this.showModeSwitches && this.showHeatMode) {
      this.modeSwitchSvc[OperationMode.HEAT] = this.accessory.getService(`${this.MODE_SWITCH_SVC_PREFIX}_HEAT`)
        ?? this.accessory.addService(this.platform.Service.Switch, `${accessory.displayName} Heat Mode`, `${this.MODE_SWITCH_SVC_PREFIX}_HEAT`)
    }

    if (this.showModeSwitches && this.shouldExposeDryMode()) {
      this.modeSwitchSvc[OperationMode.DRY] = this.accessory.getService(`${this.MODE_SWITCH_SVC_PREFIX}_DRY`)
        ?? this.accessory.addService(this.platform.Service.Switch, `${accessory.displayName} Dry Mode`, `${this.MODE_SWITCH_SVC_PREFIX}_DRY`)
    }

    // Remove any switches the current options no longer create
    const wantedSuffixes = new Set<string>()
    if (this.showModeSwitches) {
      wantedSuffixes.add('COOL')
      wantedSuffixes.add('FAN_ONLY')
      wantedSuffixes.add('ENERGY_SAVER')
      if (this.showHeatMode) {
        wantedSuffixes.add('HEAT')
      }
      if (this.shouldExposeDryMode()) {
        wantedSuffixes.add('DRY')
      }
    }
    for (const suffix of ['COOL', 'FAN_ONLY', 'ENERGY_SAVER', 'HEAT', 'DRY']) {
      if (!wantedSuffixes.has(suffix)) {
        const existing = this.accessory.getService(`${this.MODE_SWITCH_SVC_PREFIX}_${suffix}`)
        if (existing) {
          this.accessory.removeService(existing)
        }
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
          this.platform.Characteristic.CurrentHeaterCoolerState.HEATING,
          this.platform.Characteristic.CurrentHeaterCoolerState.COOLING,
        ],
      })
      .onGet(this.handleGetCurrentHeaterCoolerState.bind(this))

    // Target mode (COOL, plus HEAT unless hidden for cooling-only models)
    this.heaterCoolerSvc
      .getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .setProps({
        validValues: this.showHeatMode
          ? [
              this.platform.Characteristic.TargetHeaterCoolerState.HEAT,
              this.platform.Characteristic.TargetHeaterCoolerState.COOL,
            ]
          : [this.platform.Characteristic.TargetHeaterCoolerState.COOL],
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

    // Heating threshold temperature
    this.heaterCoolerSvc
      .getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .setProps({
        minValue: 17.7778, // 64F
        maxValue: 30, // 86F
      })
      .onGet(this.handleGetHeatingThresholdTemperature.bind(this))
      .onSet(this.handleSetHeatingThresholdTemperature.bind(this))

    // Rotation speed
    this.heaterCoolerSvc
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.handleGetRotationSpeed.bind(this))
      .onSet(this.handleSetRotationSpeed.bind(this))

    // Separate fan service characteristics
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

    // Swing mode
    this.heaterCoolerSvc
      .getCharacteristic(this.platform.Characteristic.SwingMode)
      .onGet(this.handleGetSwingMode.bind(this))
      .onSet(this.handleSetSwingMode.bind(this))

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

    // Start an update interval to refresh state
    interval(this.deviceRefreshRate * 1000)
      .pipe(startWith(0))
      .subscribe(this.refreshState.bind(this))
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

  private async getSwingMode(): Promise<AcSwingMode> {
    try {
      const value = await this.getErdValue(ERD_TYPES.AIR_CONDITIONER_SWING_MODE)

      return value as AcSwingMode
    } catch (cause) {
      // Some devices (e.g. PHNT10CC) do not support the swing mode ERD and return a 400 error
      const axiosCause = cause instanceof Error ? cause.cause : null
      if (axios.isAxiosError(axiosCause) && axiosCause.response?.status === 400) {
        this.platform.log.debug(`[${this.accessory.displayName}] Swing mode not supported by this device, defaulting to disabled`)
        return AcSwingMode.DISABLED
      }

      throw new Error(`Failed to get swing mode: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
    }
  }

  private async setSwingMode(value: AcSwingMode): Promise<void> {
    try {
      await this.setErdValue(ERD_TYPES.AIR_CONDITIONER_SWING_MODE, value)

      this.platform.log.debug(`[${this.accessory.displayName}] Set swing mode to ${value}`)
    } catch (cause) {
      throw new Error(`Failed to set swing mode: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
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

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
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
        // If the air conditioner is currently off, turn it on
        if (powerState === PowerState.OFF) {
          await this.setPowerState(PowerState.ON)
        }

        // HomeKit exposes this service as Cool, but use the configured default
        // SmartHQ operating mode whenever the AC service is activated
        await this.setOperationMode(this.defaultOperationMode)

        // Keep mode switches in sync
        for (const mode of this.getSupportedOperationModes()) {
          this.modeSwitchSvc[mode]?.updateCharacteristic(
            this.platform.Characteristic.On,
            mode === this.defaultOperationMode,
          )
        }

        // Update CurrentHeaterCoolerState
        this.heaterCoolerSvc.updateCharacteristic(
          this.platform.Characteristic.CurrentHeaterCoolerState,
          this.defaultOperationMode === OperationMode.HEAT
            ? (ambientTemperature >= targetTemperature
                ? this.platform.Characteristic.CurrentHeaterCoolerState.IDLE
                : this.platform.Characteristic.CurrentHeaterCoolerState.HEATING)
            : (ambientTemperature <= targetTemperature
                ? this.platform.Characteristic.CurrentHeaterCoolerState.IDLE
                : this.platform.Characteristic.CurrentHeaterCoolerState.COOLING),
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
      const [powerState, ambientTemperature, targetTemperature, operationMode] = await Promise.all([
        this.getPowerState(),
        this.getAmbientTemperature(),
        this.getTemperature(),
        this.getOperationMode(),
      ])

      if (powerState === PowerState.OFF) {
        return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE
      }

      if (operationMode === OperationMode.HEAT) {
        if (ambientTemperature >= targetTemperature) {
          return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE
        }

        // Keep TargetHeaterCoolerState in sync
        this.heaterCoolerSvc.updateCharacteristic(
          this.platform.Characteristic.TargetHeaterCoolerState,
          this.platform.Characteristic.TargetHeaterCoolerState.HEAT,
        )

        return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING
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

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  }

  public async handleGetTargetHeaterCoolerState(): Promise<CharacteristicValue> {
    try {
      const operationMode = await this.getOperationMode()

      return operationMode === OperationMode.HEAT
        ? this.platform.Characteristic.TargetHeaterCoolerState.HEAT
        : this.platform.Characteristic.TargetHeaterCoolerState.COOL
    } catch (cause) {
      const error = new Error(`Failed to handle get target heater cooler state: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  }

  public async handleSetTargetHeaterCoolerState(value: CharacteristicValue): Promise<void> {
    try {
      const powerState: PowerState = await this.getPowerState()

      // Turn on the air conditioner if it's currently off
      if (powerState === PowerState.OFF) {
        await this.setPowerState(PowerState.ON)
      }

      if (value === this.platform.Characteristic.TargetHeaterCoolerState.HEAT) {
        await this.setOperationMode(OperationMode.HEAT)

        // Keep CurrentHeaterCoolerState in sync with TargetHeaterCoolerState
        this.heaterCoolerSvc.updateCharacteristic(
          this.platform.Characteristic.CurrentHeaterCoolerState,
          this.platform.Characteristic.CurrentHeaterCoolerState.HEATING,
        )

        // Keep mode switches in sync
        for (const mode of this.getSupportedOperationModes()) {
          this.modeSwitchSvc[mode]?.updateCharacteristic(
            this.platform.Characteristic.On,
            mode === OperationMode.HEAT,
          )
        }
      } else {
        // HomeKit exposes this as Cool, but use the configured default SmartHQ
        // operating mode (which is cool unless changed by the user)
        const targetMode = this.defaultOperationMode === OperationMode.HEAT
          ? OperationMode.COOL
          : this.defaultOperationMode
        await this.setOperationMode(targetMode)

        // Keep CurrentHeaterCoolerState in sync with TargetHeaterCoolerState
        this.heaterCoolerSvc.updateCharacteristic(
          this.platform.Characteristic.CurrentHeaterCoolerState,
          this.platform.Characteristic.CurrentHeaterCoolerState.COOLING,
        )

        // Keep mode switches in sync
        for (const mode of this.getSupportedOperationModes()) {
          this.modeSwitchSvc[mode]?.updateCharacteristic(
            this.platform.Characteristic.On,
            mode === targetMode,
          )
        }
      }
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

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  }

  public async handleGetCoolingThresholdTemperature(): Promise<number> {
    try {
      const value: number = await this.getTemperature()

      return value
    } catch (cause) {
      const error = new Error(`Failed to handle get cooling threshold temperature: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
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

  public async handleGetHeatingThresholdTemperature(): Promise<number> {
    try {
      const value: number = await this.getTemperature()

      return value
    } catch (cause) {
      const error = new Error(`Failed to handle get heating threshold temperature: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  }

  public async handleSetHeatingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    try {
      const targetTemperature = Number.parseFloat(value as string)

      await this.setTemperature(targetTemperature)
    } catch (cause) {
      const error = new Error(`Failed to handle set heating threshold temperature: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
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

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
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

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
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

      // Fan off / 0% maps to SmartHQ Auto and does not power off the AC
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

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
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

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  }

  public async handleGetSwingMode(): Promise<CharacteristicValue> {
    if (!this.swingModeSupported) {
      return this.platform.Characteristic.SwingMode.SWING_DISABLED
    }
    try {
      const value: AcSwingMode = await this.getSwingMode()

      return value === AcSwingMode.ENABLED
        ? this.platform.Characteristic.SwingMode.SWING_ENABLED
        : this.platform.Characteristic.SwingMode.SWING_DISABLED
    } catch (cause) {
      // Some models (e.g. the PWDV08WWF) have no swing hardware and return no
      // value for the swing ERD - remember that instead of erroring forever
      if (cause instanceof Error && cause.message.includes('No value returned')) {
        this.swingModeSupported = false
        this.platform.log.info(`[${this.accessory.displayName}] Swing mode is not supported by this model, disabling`)
        return this.platform.Characteristic.SwingMode.SWING_DISABLED
      }
      const error = new Error(`Failed to handle get swing mode: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
      this.platform.log.error(`[${this.accessory.displayName}] ${error.message}`)

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  }

  public async handleSetSwingMode(value: CharacteristicValue): Promise<void> {
    if (!this.swingModeSupported) {
      return
    }
    try {
      const swingMode = value === this.platform.Characteristic.SwingMode.SWING_ENABLED
        ? AcSwingMode.ENABLED
        : AcSwingMode.DISABLED

      await this.setSwingMode(swingMode)
    } catch (cause) {
      const error = new Error(`Failed to handle set swing mode: ${cause instanceof Error ? cause.message : 'An unknown error occurred'}`, { cause })
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

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
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
          mode === OperationMode.HEAT
            ? this.platform.Characteristic.CurrentHeaterCoolerState.HEATING
            : this.platform.Characteristic.CurrentHeaterCoolerState.COOLING,
        )

        // Keep TargetHeaterCoolerState in sync
        this.heaterCoolerSvc.updateCharacteristic(
          this.platform.Characteristic.TargetHeaterCoolerState,
          mode === OperationMode.HEAT
            ? this.platform.Characteristic.TargetHeaterCoolerState.HEAT
            : this.platform.Characteristic.TargetHeaterCoolerState.COOL,
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
        case OperationMode.HEAT:
          return 'Heat Mode'
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

      // Heating threshold temperature
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.HeatingThresholdTemperature,
        await this.handleGetHeatingThresholdTemperature(),
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

      // Swing mode
      this.heaterCoolerSvc.updateCharacteristic(
        this.platform.Characteristic.SwingMode,
        await this.handleGetSwingMode(),
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
    }
  }

  // Helpers

  private shouldExposeDryMode(): boolean {
    return this.supportsDryMode && this.showDryModeSwitch
  }

  private getSupportedOperationModes(): OperationMode[] {
    const modes = [OperationMode.COOL, OperationMode.FAN_ONLY, OperationMode.ENERGY_SAVER]
    if (this.showHeatMode) {
      modes.push(OperationMode.HEAT)
    }
    if (this.shouldExposeDryMode()) {
      modes.push(OperationMode.DRY)
    }
    return modes
  }

  private fahrenheitToCelsius(fahrenheit: number): number {
    return (fahrenheit - 32) * 5 / 9
  }

  private celsiusToFahrenheit(celsius: number): number {
    return (celsius * 9 / 5) + 32
  }
}
