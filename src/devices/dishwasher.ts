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

export class SmartHQDishWasher extends deviceBase {
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

    this.debugLog(`Dishwasher Features: ${JSON.stringify(accessory.context.device.features)}`)
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
    interval(this.deviceRefreshRate * 10000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(async () => {
        // await this.refreshStatus()
      })
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

    // Check if DishwasherDevice device type is available
    if (!matterAPI.deviceTypes.DishwasherDevice) {
      if (this.device.matterOnly) {
        this.errorLog('Matter DishwasherDevice device type not available - accessory will NOT be published (matterOnly mode enabled)')
        this.errorLog('Reason: Required Matter device type "DishwasherDevice" is not available in this Homebridge version')
        this.errorLog(`Available Matter device types: ${Object.keys(matterAPI.deviceTypes).join(', ')}`)
        return
      }
      this.warnLog('Matter DishwasherDevice device type not available in this Homebridge version - falling back to HAP')
      this.warnLog(`Available Matter device types: ${Object.keys(matterAPI.deviceTypes).join(', ')}`)
      this.useMatterOverride = false
      this.initializeHAP()
      return
    }

    const serialNumber = this.device.applianceId || 'unknown'
    this.matterUuid = matterAPI.uuid.generate(serialNumber)

    // Create Matter accessory configuration with dishwasher-specific clusters
    const matterAccessory = {
      UUID: this.matterUuid,
      displayName: this.device.nickname || 'SmartHQ Dishwasher',
      serialNumber,
      manufacturer: this.device.brand && this.device.brand !== 'Unknown' ? this.device.brand : 'GE Appliances',
      model: this.device.model || 'SmartHQ',
      firmwareRevision: this.deviceFirmwareVersion,
      hardwareRevision: this.deviceFirmwareVersion,
      deviceType: matterAPI.deviceTypes.DishwasherDevice,
      clusters: {
        // On/Off cluster for dishwasher power state
        onOff: {
          onOff: false,
        },
        // Operational State cluster for cycle status (maps to DISHWASHER_CYCLE)
        operationalState: {
          operationalState: 0, // 0=Stopped, 1=Running, 2=Paused
          operationalError: { errorStateID: 0 },
          phaseList: ['Washing', 'Rinsing', 'Drying'],
          currentPhase: 0,
        },
        // Timer cluster for time remaining (maps to DISHWASHER_CYCLE_PHASE_TIME_REMAINING)
        timer: {
          timerState: 0, // 0=Stopped, 1=Running, 2=Paused
          duration: 0,
          remainingTime: 0,
        },
        // Dishwasher Mode cluster for cycle selection
        dishwasherMode: {
          supportedModes: [
            { label: 'Normal', mode: 0 },
            { label: 'Heavy', mode: 1 },
            { label: 'Light', mode: 2 },
            { label: 'Quick', mode: 3 },
          ],
          currentMode: 0,
        },
        // Dishwasher Alarm cluster for cycle completion
        dishwasherAlarm: {
          mask: 0,
          state: 0,
          supported: 1, // Bit 0: Cycle complete
        },
      },
      handlers: {
        onOff: {
          on: async () => {
            await this.writeErd(ERD_TYPES.DISHWASHER_CYCLE, true)
          },
          off: async () => {
            await this.writeErd(ERD_TYPES.DISHWASHER_CYCLE, false)
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
    this.infoLog('Registered Matter Dishwasher as external accessory with operational state, timer, mode selection, and alarm clusters')
  }

  /**
   * Initialize HAP (HomeKit) protocol
   */
  private initializeHAP(): void {
    // Dishwasher Running State (Valve for active/inactive)
    const dishwasherValve = this.accessory!.getService('Dishwasher') ?? this.accessory!.addService(this.platform.Service.Valve, 'Dishwasher', 'Dishwasher')
    dishwasherValve.setCharacteristic(this.platform.Characteristic.Name, 'Dishwasher')
    dishwasherValve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)
    dishwasherValve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        try {
          const r = await this.readErd(ERD_TYPES.DISHWASHER_CYCLE)
          return r && Number.parseInt(r) !== 0 ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE
        } catch (error: any) {
          this.warnLog?.(`Dishwasher Active error: ${error?.message ?? error}`)
          return this.platform.Characteristic.Active.INACTIVE
        }
      })
      .onSet(async (value) => {
        try {
          await this.writeErd(ERD_TYPES.DISHWASHER_CYCLE, value === this.platform.Characteristic.Active.ACTIVE)
        } catch (error: any) {
          this.warnLog?.(`Dishwasher Active set error: ${error?.message ?? error}`)
        }
      })

    dishwasherValve
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        try {
          const r = await this.readErd(ERD_TYPES.DISHWASHER_CYCLE)
          return r && Number.parseInt(r) !== 0 ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE
        } catch (error: any) {
          this.warnLog?.(`Dishwasher InUse error: ${error?.message ?? error}`)
          return this.platform.Characteristic.InUse.NOT_IN_USE
        }
      })

    // Dishwasher Door Sensor
    const doorSensor = this.accessory!.getService('Dishwasher Door') ?? this.accessory!.addService(this.platform.Service.ContactSensor, 'Dishwasher Door', 'DishwasherDoor')
    doorSensor.setCharacteristic(this.platform.Characteristic.Name, 'Dishwasher Door')
    doorSensor
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.LAUNDRY_DOOR)
        // 0=closed (detected), 1=open (not detected)
        return r && Number.parseInt(r) === 1
          ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
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
