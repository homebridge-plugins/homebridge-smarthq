/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * hood.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { interval, startWith } from 'rxjs'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

enum FanSpeed {
  OFF = '00',
  LOW = '01',
  MEDIUM = '02',
  HIGH = '03',
  BOOST = '04',
}

enum LightLevel {
  OFF = '00',
  DIM = '01',
  HIGH = '02',
}

export class SmartHQHood extends deviceBase {
  private readonly FAN_SVC_NAME = 'HOOD_FAN'
  private readonly LIGHT_SVC_NAME = 'HOOD_LIGHT'
  private fanSvc!: Service
  private lightSvc!: Service

  // Matter support override flag
  private useMatterOverride: boolean = false

  constructor(
    protected readonly platform: SmartHQPlatform,
    protected readonly accessory: PlatformAccessory<SmartHqContext>,
    protected readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    // Check if we should use Matter protocol
    this.useMatterOverride = device.useMatter ?? false

    this.debugLog(`Hood Features: ${JSON.stringify(accessory.context.device.features)}`)
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
      displayName: this.device.nickname || 'SmartHQ Hood',
      serialNumber,
      manufacturer: this.device.brand && this.device.brand !== 'Unknown' ? this.device.brand : 'GE Appliances',
      model: this.device.model || 'SmartHQ',
      firmwareRevision: this.deviceFirmwareVersion,
      hardwareRevision: this.deviceFirmwareVersion,
      deviceType: matterAPI.deviceTypes.CookTop, // Hood is part of cooktop
      clusters: {
        // Fan Control cluster for hood fan
        fanControl: {
          fanMode: 0, // 0=Off, 1=Low, 2=Medium, 3=High, 4=Boost
          fanModeSequence: 4,
          percentSetting: 0,
          percentCurrent: 0,
        },
        // On/Off cluster for light
        onOff: {
          onOff: false,
        },
        // Level Control for light dimming
        levelControl: {
          currentLevel: 0,
          minLevel: 0,
          maxLevel: 254,
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
    this.infoLog('Registered Matter Hood as external accessory with fan control and dimmable light clusters')
  }

  /**
   * Initialize HAP (HomeKit) protocol
   */
  private initializeHAP(): void {
    this.fanSvc = this.accessory!.getService(this.FAN_SVC_NAME)
      ?? this.accessory!.addService(
        this.platform.Service.Fanv2,
        `${this.accessory.displayName} Fan`,
        this.FAN_SVC_NAME,
      )

    this.lightSvc = this.accessory!.getService(this.LIGHT_SVC_NAME)
      ?? this.accessory!.addService(
        this.platform.Service.Lightbulb,
        `${this.accessory.displayName} Light`,
        this.LIGHT_SVC_NAME,
      )

    const fanSwitchSvc = this.accessory!.getService('HOOD_FAN_SWITCH')
    if (fanSwitchSvc) {
      this.accessory.removeService(fanSwitchSvc)
    }

    const lightSwitchSvc = this.accessory!.getService('HOOD_LIGHT_SWITCH')
    if (lightSwitchSvc) {
      this.accessory.removeService(lightSwitchSvc)
    }

    this.fanSvc
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.handleGetFanActive.bind(this))
      .onSet(this.handleSetFanActive.bind(this))

    this.fanSvc
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 25,
      })
      .onGet(this.handleGetFanRotationSpeed.bind(this))
      .onSet(this.handleSetFanRotationSpeed.bind(this))

    this.lightSvc
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.handleGetLightOn.bind(this))
      .onSet(this.handleSetLightOn.bind(this))

    this.lightSvc
      .getCharacteristic(this.platform.Characteristic.Brightness)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 50,
      })
      .onGet(this.handleGetLightBrightness.bind(this))
      .onSet(this.handleSetLightBrightness.bind(this))

    interval(this.deviceRefreshRate * 1000)
      .pipe(startWith(0))
      .subscribe(this.refreshState.bind(this))
  }

  private async getFanSpeed(): Promise<FanSpeed> {
    const value = await this.readErd(ERD_TYPES.HOOD_FAN_SPEED)
    if (!value) {
      throw new Error('Failed to get fan speed: ERD not available')
    }
    return value as FanSpeed
  }

  private async setFanSpeed(value: FanSpeed): Promise<void> {
    await this.writeErd(ERD_TYPES.HOOD_FAN_SPEED, value)
  }

  private async getLightLevel(): Promise<LightLevel> {
    const value = await this.readErd(ERD_TYPES.HOOD_LIGHT_LEVEL)
    if (!value) {
      throw new Error('Failed to get light level: ERD not available')
    }
    return value as LightLevel
  }

  private async setLightLevel(value: LightLevel): Promise<void> {
    await this.writeErd(ERD_TYPES.HOOD_LIGHT_LEVEL, value)
  }

  private fanSpeedToRotationSpeed(fanSpeed: FanSpeed): number {
    switch (fanSpeed) {
      case FanSpeed.OFF:
        return 0
      case FanSpeed.LOW:
        return 25
      case FanSpeed.MEDIUM:
        return 50
      case FanSpeed.HIGH:
        return 75
      case FanSpeed.BOOST:
        return 100
      default:
        return 0
    }
  }

  private rotationSpeedToFanSpeed(rotationSpeed: number): FanSpeed {
    if (rotationSpeed === 0) {
      return FanSpeed.OFF
    }
    if (rotationSpeed <= 25) {
      return FanSpeed.LOW
    }
    if (rotationSpeed <= 50) {
      return FanSpeed.MEDIUM
    }
    if (rotationSpeed <= 75) {
      return FanSpeed.HIGH
    }
    return FanSpeed.BOOST
  }

  private lightLevelToBrightness(lightLevel: LightLevel): number {
    switch (lightLevel) {
      case LightLevel.OFF:
        return 0
      case LightLevel.DIM:
        return 50
      case LightLevel.HIGH:
        return 100
      default:
        return 0
    }
  }

  private brightnessToLightLevel(brightness: number): LightLevel {
    if (brightness === 0) {
      return LightLevel.OFF
    }
    if (brightness <= 50) {
      return LightLevel.DIM
    }
    return LightLevel.HIGH
  }

  handleGetFanActive(): Promise<CharacteristicValue> {
    return this.getFanSpeed()
      .then((fanSpeed) => {
        const isActive = fanSpeed !== FanSpeed.OFF
        const value = isActive ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE
        this.debugLog(`Get fan active: ${isActive}`)
        return value
      })
      .catch((err) => {
        this.errorLog(`handleGetFanActive failed: ${err.message}`)
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      })
  }

  handleSetFanActive(value: CharacteristicValue): Promise<void> {
    const isActive = value === this.platform.Characteristic.Active.ACTIVE
    const fanSpeed = isActive ? FanSpeed.LOW : FanSpeed.OFF

    this.debugLog(`Set fan active: ${isActive}`)

    return this.setFanSpeed(fanSpeed)
      .then(() => {
        const rotationSpeed = isActive ? 25 : 0
        this.fanSvc.updateCharacteristic(this.platform.Characteristic.RotationSpeed, rotationSpeed)
      })
      .catch((err) => {
        this.errorLog(`handleSetFanActive failed: ${err.message}`)
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      })
  }

  handleGetFanRotationSpeed(): Promise<CharacteristicValue> {
    return this.getFanSpeed()
      .then((fanSpeed) => {
        const rotationSpeed = this.fanSpeedToRotationSpeed(fanSpeed)
        this.debugLog(`Get fan rotation speed: ${rotationSpeed}% (${fanSpeed})`)
        return rotationSpeed
      })
      .catch((err) => {
        this.errorLog(`handleGetFanRotationSpeed failed: ${err.message}`)
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      })
  }

  handleSetFanRotationSpeed(value: CharacteristicValue): Promise<void> {
    const rotationSpeed = value as number
    const fanSpeed = this.rotationSpeedToFanSpeed(rotationSpeed)

    this.debugLog(`Set fan rotation speed: ${rotationSpeed}% -> ${fanSpeed}`)

    return this.setFanSpeed(fanSpeed)
      .then(() => {
        this.fanSvc.updateCharacteristic(this.platform.Characteristic.RotationSpeed, rotationSpeed)
      })
      .catch((err) => {
        this.errorLog(`handleSetFanRotationSpeed failed: ${err.message}`)
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      })
  }

  handleGetLightOn(): Promise<CharacteristicValue> {
    return this.getLightLevel()
      .then((lightLevel) => {
        const isOn = lightLevel !== LightLevel.OFF
        this.debugLog(`Get light on: ${isOn}`)
        return isOn
      })
      .catch((err) => {
        this.errorLog(`handleGetLightOn failed: ${err.message}`)
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      })
  }

  handleSetLightOn(value: CharacteristicValue): Promise<void> {
    const isOn = value as boolean
    const lightLevel = isOn ? LightLevel.DIM : LightLevel.OFF

    this.debugLog(`Set light on: ${isOn}`)

    return this.setLightLevel(lightLevel)
      .then(() => {
        const brightness = isOn ? 50 : 0
        this.lightSvc.updateCharacteristic(this.platform.Characteristic.Brightness, brightness)
      })
      .catch((err) => {
        this.errorLog(`handleSetLightOn failed: ${err.message}`)
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      })
  }

  handleGetLightBrightness(): Promise<CharacteristicValue> {
    return this.getLightLevel()
      .then((lightLevel) => {
        const brightness = this.lightLevelToBrightness(lightLevel)
        this.debugLog(`Get light brightness: ${brightness}% (${lightLevel})`)
        return brightness
      })
      .catch((err) => {
        this.errorLog(`handleGetLightBrightness failed: ${err.message}`)
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      })
  }

  handleSetLightBrightness(value: CharacteristicValue): Promise<void> {
    const brightness = value as number
    const lightLevel = this.brightnessToLightLevel(brightness)

    this.debugLog(`Set light brightness: ${brightness}% -> ${lightLevel}`)

    return this.setLightLevel(lightLevel)
      .then(() => {
        this.lightSvc.updateCharacteristic(this.platform.Characteristic.Brightness, brightness)
      })
      .catch((err) => {
        this.errorLog(`handleSetLightBrightness failed: ${err.message}`)
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      })
  }

  refreshState(): Promise<void> {
    return Promise.all([
      this.getFanSpeed(),
      this.getLightLevel(),
    ])
      .then(([fanSpeed, lightLevel]) => {
        const isActive = fanSpeed !== FanSpeed.OFF
        const rotationSpeed = this.fanSpeedToRotationSpeed(fanSpeed)
        const isOn = lightLevel !== LightLevel.OFF
        const brightness = this.lightLevelToBrightness(lightLevel)

        this.fanSvc.updateCharacteristic(
          this.platform.Characteristic.Active,
          isActive ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE,
        )
        this.fanSvc.updateCharacteristic(this.platform.Characteristic.RotationSpeed, rotationSpeed)

        this.lightSvc.updateCharacteristic(this.platform.Characteristic.On, isOn)
        this.lightSvc.updateCharacteristic(this.platform.Characteristic.Brightness, brightness)

        this.debugLog(`State refreshed - Fan: ${fanSpeed} (${rotationSpeed}%), Light: ${lightLevel} (${brightness}%)`)
      })
      .catch((err) => {
        this.errorLog(`Failed to refresh state: ${err.message}`)
      })
  }
}
