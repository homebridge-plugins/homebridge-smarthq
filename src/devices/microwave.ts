/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * microwave.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { deviceBase } from './device.js'

export class SmartHQMicrowave extends deviceBase {
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

    this.debugLog(`Microwave Features: ${JSON.stringify(accessory.context.device.features)}`)
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
      displayName: this.device.nickname || 'SmartHQ Microwave',
      serialNumber,
      manufacturer: this.device.brand && this.device.brand !== 'Unknown' ? this.device.brand : 'GE Appliances',
      model: this.device.model || 'SmartHQ',
      firmwareRevision: this.deviceFirmwareVersion,
      hardwareRevision: this.deviceFirmwareVersion,
      deviceType: matterAPI.deviceTypes.MicrowaveOven,
      clusters: {
        // On/Off cluster for light
        onOff: {
          onOff: false,
        },
        // Operational State for microwave running
        operationalState: {
          operationalState: 0,
          operationalError: { errorStateID: 0 },
        },
        // Timer cluster for cook time
        timer: {
          timerState: 0,
          duration: 0,
          remainingTime: 0,
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
    this.infoLog('Registered Matter Microwave as external accessory with operational state and timer clusters')
  }

  /**
   * Initialize HAP (HomeKit) protocol
   */
  private initializeHAP(): void {
    // Microwave Light
    const light = this.accessory!.getService('Microwave Light') ?? this.accessory!.addService(this.platform.Service.Lightbulb, 'Microwave Light', 'MicrowaveLight')
    this.setServiceName(light, 'Microwave Light')
    light
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        try {
          // TODO: Implement light state ERD
          return false
        } catch (error: any) {
          this.warnLog?.(`Microwave Light error: ${error?.message ?? error}`)
          return false
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement light control ERD
          this.debugLog(`Microwave Light set to: ${value}`)
        } catch (error: any) {
          this.warnLog?.(`Microwave Light set error: ${error?.message ?? error}`)
        }
      })

    // Microwave Running State (Switch)
    const runningSwitch = this.accessory!.getService('Microwave') ?? this.accessory!.addService(this.platform.Service.Switch, 'Microwave', 'Microwave')
    this.setServiceName(runningSwitch, 'Microwave')
    runningSwitch
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        try {
          // TODO: Implement running state ERD
          return false
        } catch (error: any) {
          this.warnLog?.(`Microwave Running error: ${error?.message ?? error}`)
          return false
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement running control ERD
          this.debugLog(`Microwave Running set to: ${value}`)
        } catch (error: any) {
          this.warnLog?.(`Microwave Running set error: ${error?.message ?? error}`)
        }
      })

    // Ventilation Fan (if applicable)
    const fan = this.accessory!.getService('Microwave Fan') ?? this.accessory!.addService(this.platform.Service.Fanv2, 'Microwave Fan', 'MicrowaveFan')
    this.setServiceName(fan, 'Microwave Fan')
    fan
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        try {
          // TODO: Implement fan state ERD
          return this.platform.Characteristic.Active.INACTIVE
        } catch (error: any) {
          this.warnLog?.(`Microwave Fan error: ${error?.message ?? error}`)
          return this.platform.Characteristic.Active.INACTIVE
        }
      })
      .onSet(async (value) => {
        try {
          // TODO: Implement fan control ERD
          this.debugLog(`Microwave Fan set to: ${value}`)
        } catch (error: any) {
          this.warnLog?.(`Microwave Fan set error: ${error?.message ?? error}`)
        }
      })
  }
}
