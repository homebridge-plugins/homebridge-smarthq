/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * oven.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

export class SmartHQDishWasher extends deviceBase {
  // Updates
  deviceStatus: any

  // HAP services kept for live websocket updates (#22)
  private dishwasherValve?: Service
  private doorSensor?: Service

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
      // ⚠️ Deliberately NOT honouring matterOnly here. Homebridge has no
      // DishwasherDevice device type at all, so this is not a "Matter is
      // temporarily unavailable" case that might resolve on a restart - it can
      // never be satisfied. Refusing to publish would mean the appliance simply
      // never appears, with only a log line to explain why. Fall back to HAP and
      // say so loudly instead (#111).
      if (this.device.matterOnly) {
        this.warnLog('Ignoring matterOnly: Homebridge has no DishwasherDevice device type, so Matter can never be used for this appliance. Publishing over HAP instead.')
        this.warnLog('The Matter options have been hidden in the plugin settings for this reason; you can safely remove matterOnly from your config.')
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
    // Dishwasher Running State: keyed on the real operating mode ERD (0x3001,
    // gehome ErdOperatingMode) - the previous 0x6000-series codes were
    // fabricated and every read of them returned a 400 (#22). The tile is a
    // read-only display: 3=delay start, 4=paused, 5=cycle active count as
    // engaged, with in-use meaning an actively running cycle.
    const dishwasherValve = this.accessory!.getService('Dishwasher') ?? this.accessory!.addService(this.platform.Service.Valve, 'Dishwasher', 'Dishwasher')
    this.dishwasherValve = dishwasherValve
    this.setServiceName(dishwasherValve, 'Dishwasher')
    dishwasherValve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)
    dishwasherValve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        return await this.isCycleEngaged()
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE
      })
      .onSet(async () => {
        // Read-only display - revert the toggle so a tap doesn't silently
        // pretend to work (dishwashers cannot be started remotely over the
        // SmartHQ api)
        this.infoLog('The Dishwasher tile is a read-only display; starting or stopping a cycle from HomeKit is not supported')
        dishwasherValve.updateCharacteristic(
          this.platform.Characteristic.Active,
          await this.isCycleEngaged()
            ? this.platform.Characteristic.Active.ACTIVE
            : this.platform.Characteristic.Active.INACTIVE,
        )
      })

    dishwasherValve
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        return await this.isCycleRunning()
          ? this.platform.Characteristic.InUse.IN_USE
          : this.platform.Characteristic.InUse.NOT_IN_USE
      })

    dishwasherValve
      .getCharacteristic(this.platform.Characteristic.RemainingDuration)
      // The default maximum is 3600s. A normal two hour cycle is 7200, which
      // HomeKit rejected as an illegal value and clamped to 60 minutes, so the
      // tile showed the wrong time for the whole first hour. The laundry devices
      // already raise it the same way.
      .setProps({ maxValue: 86400 })
      .onGet(async () => this.getRemainingSeconds())

    // Dishwasher Door Sensor
    const doorSensor = this.accessory!.getService('Dishwasher Door') ?? this.accessory!.addService(this.platform.Service.ContactSensor, 'Dishwasher Door', 'DishwasherDoor')
    this.doorSensor = doorSensor
    this.setServiceName(doorSensor, 'Dishwasher Door')
    doorSensor
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.DISHWASHER_DOOR_STATUS)
        // 0=closed (detected), 1=open (not detected)
        return r && Number.parseInt(r, 16) === 1
          ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
      })
  }

  /**
   * Whether a cycle is engaged in any form: delay start (3), paused (4) or
   * actively running (5) - per gehome's ErdOperatingMode
   */
  private async isCycleEngaged(): Promise<boolean> {
    const r = await this.try_get_erd_value(ERD_TYPES.DISHWASHER_OPERATING_MODE)
    return !!r && [3, 4, 5].includes(Number.parseInt(r, 16))
  }

  /** Whether a cycle is actively running right now (operating mode 5) */
  private async isCycleRunning(): Promise<boolean> {
    const r = await this.try_get_erd_value(ERD_TYPES.DISHWASHER_OPERATING_MODE)
    return !!r && Number.parseInt(r, 16) === 5
  }

  /**
   * Remaining cycle time in seconds, clamped to HomeKit's maximum. The raw
   * value is treated as minutes (gehome's timespan convention) - to be
   * confirmed against a real appliance log (#22).
   */
  private async getRemainingSeconds(): Promise<number> {
    const r = await this.try_get_erd_value(ERD_TYPES.DISHWASHER_TIME_REMAINING)
    if (!r) {
      return 0
    }
    const minutes = Number.parseInt(r, 16)
    if (Number.isNaN(minutes) || minutes <= 0) {
      return 0
    }
    return Math.min(minutes * 60, 86400)
  }

  /**
   * Reflect pushed ERD changes in HomeKit as they happen (#22)
   */
  onErdUpdate(erd: string): void {
    if (this.useMatterOverride) {
      return
    }
    void this.applyLiveUpdate(erd)
  }

  private async applyLiveUpdate(erd: string): Promise<void> {
    try {
      switch (erd) {
        case ERD_TYPES.DISHWASHER_OPERATING_MODE: {
          this.dishwasherValve?.updateCharacteristic(
            this.platform.Characteristic.Active,
            await this.isCycleEngaged()
              ? this.platform.Characteristic.Active.ACTIVE
              : this.platform.Characteristic.Active.INACTIVE,
          )
          this.dishwasherValve?.updateCharacteristic(
            this.platform.Characteristic.InUse,
            await this.isCycleRunning()
              ? this.platform.Characteristic.InUse.IN_USE
              : this.platform.Characteristic.InUse.NOT_IN_USE,
          )
          break
        }
        case ERD_TYPES.DISHWASHER_TIME_REMAINING: {
          this.dishwasherValve?.updateCharacteristic(this.platform.Characteristic.RemainingDuration, await this.getRemainingSeconds())
          break
        }
        case ERD_TYPES.DISHWASHER_DOOR_STATUS: {
          const r = await this.try_get_erd_value(ERD_TYPES.DISHWASHER_DOOR_STATUS)
          this.doorSensor?.updateCharacteristic(
            this.platform.Characteristic.ContactSensorState,
            r && Number.parseInt(r, 16) === 1
              ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
              : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED,
          )
          break
        }
      }
    } catch (error: any) {
      this.debugLog(`Live dishwasher update for ${erd} failed: ${error?.message ?? error}`)
    }
  }
}
