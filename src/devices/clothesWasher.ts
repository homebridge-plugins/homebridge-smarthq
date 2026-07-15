import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

export class SmartHQClothesWasher extends deviceBase {
  // Updates
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

    this.debugLog(`Clothes Washer Features: ${JSON.stringify(accessory.context.device.features)}`)
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

    // Check if LaundryWasherDevice device type is available
    if (!matterAPI.deviceTypes.LaundryWasherDevice) {
      if (this.device.matterOnly) {
        this.errorLog('Matter LaundryWasherDevice device type not available - accessory will NOT be published (matterOnly mode enabled)')
        this.errorLog('Reason: Required Matter device type "LaundryWasherDevice" is not available in this Homebridge version')
        this.errorLog(`Available Matter device types: ${Object.keys(matterAPI.deviceTypes).join(', ')}`)
        return
      }
      this.warnLog('Matter LaundryWasherDevice device type not available in this Homebridge version - falling back to HAP')
      this.warnLog(`Available Matter device types: ${Object.keys(matterAPI.deviceTypes).join(', ')}`)
      this.useMatterOverride = false
      this.initializeHAP()
      return
    }

    const serialNumber = this.device.applianceId || 'unknown'
    this.matterUuid = matterAPI.uuid.generate(serialNumber)

    // Create Matter accessory configuration with washer-specific clusters
    const matterAccessory = {
      UUID: this.matterUuid,
      displayName: this.device.nickname || 'SmartHQ Washer',
      serialNumber,
      manufacturer: this.device.brand && this.device.brand !== 'Unknown' ? this.device.brand : 'GE Appliances',
      model: this.device.model || 'SmartHQ',
      firmwareRevision: this.deviceFirmwareVersion,
      hardwareRevision: this.deviceFirmwareVersion,
      deviceType: matterAPI.deviceTypes.LaundryWasherDevice,
      clusters: {
        // Operational State cluster (maps to LAUNDRY_MACHINE_STATE)
        operationalState: {
          operationalState: 0, // 0=Stopped, 1=Running, 2=Paused
          operationalError: { errorStateID: 0 },
          phaseList: ['Fill', 'Soak', 'Wash', 'Rinse', 'Spin', 'Drain'],
          currentPhase: 0,
        },
        // LaundryWasher Mode cluster for cycle selection (maps to LAUNDRY_CYCLE)
        laundryWasherMode: {
          supportedModes: [
            { label: 'Normal', mode: 0 },
            { label: 'Delicate', mode: 1 },
            { label: 'Heavy Duty', mode: 2 },
            { label: 'Whites', mode: 3 },
            { label: 'Quick Wash', mode: 4 },
            { label: 'Sanitize', mode: 5 },
          ],
          currentMode: 0,
        },
        // Temperature Control for water temperature
        temperatureControl: {
          supportedTemperatureLevels: ['Cold', 'Warm', 'Hot'],
          selectedTemperatureLevel: 0,
        },
        // Timer cluster for time remaining (maps to LAUNDRY_TIME_REMAINING)
        timer: {
          timerState: 0,
          duration: 0,
          remainingTime: 0,
        },
        // Alarm cluster for cycle complete (maps to LAUNDRY_END_OF_CYCLE)
        alarm: {
          mask: 0,
          state: 0,
          supported: 1, // Bit 0: Cycle complete
        },
        // Door Lock cluster (maps to LAUNDRY_DOOR_LOCK)
        doorLock: {
          lockState: 0, // 0=Unlocked, 1=Locked
          lockType: 0,
          actuatorEnabled: true,
        },
        // On/Off cluster for machine active state
        onOff: {
          onOff: false,
        },
      },
      handlers: {},
    }

    // Register Matter accessory as external device
    await matterAPI.registerPlatformAccessories(
      '@homebridge-plugins/homebridge-smarthq',
      'SmartHQ',
      [matterAccessory],
    )
    this.matterRegistered = true
    this.infoLog('Created Matter Washer with operational state, mode selection, temperature control, timer, alarm, and door lock clusters')
  }

  /**
   * Initialize HAP (HomeKit) protocol
   */
  private initializeHAP(): void {
    // Washer Running State (Valve)
    const washerValve = this.accessory!.getService('Washer') ?? this.accessory!.addService(this.platform.Service.Valve, 'Washer', 'Washer')
    washerValve.setCharacteristic(this.platform.Characteristic.Name, 'Washer')
    washerValve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)

    // Set maximum duration to a large value (e.g., 12 hours = 43200 seconds)
    washerValve.getCharacteristic(this.platform.Characteristic.SetDuration).setProps({
      maxValue: 43200,
      minValue: 0,
      minStep: 60,
    })

    washerValve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.LAUNDRY_MACHINE_STATE)
        // Machine state: 0=idle, 1=running
        return r && Number.parseInt(r) !== 0 ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE
      })

    washerValve
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.LAUNDRY_MACHINE_STATE)
        return r && Number.parseInt(r) !== 0 ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE
      })

    washerValve
      .getCharacteristic(this.platform.Characteristic.RemainingDuration)
      .setProps({ maxValue: 86400 }) // default max is 3600s, laundry cycles can run longer (#60)
      .onGet(async () => {
        // Check if machine is running first
        const machineState = await this.readErd(ERD_TYPES.LAUNDRY_MACHINE_STATE)
        if (!machineState || Number.parseInt(machineState) === 0) {
          return 0 // Machine is idle, no time remaining
        }

        const r = await this.readErd(ERD_TYPES.LAUNDRY_TIME_REMAINING)
        if (!r) {
          return 0
        }
        // The raw value is already in seconds: live pushes decrement it by 60
        // every minute of wall time (#60). HomeKit's RemainingDuration is capped
        // by its maxValue, so clamp long cycles rather than send illegal values.
        const seconds = Number.parseInt(r, 16)
        const clamped = Math.min(seconds, 86400)
        this.infoLog(`Time Remaining - Hex: ${r}, Seconds: ${seconds}`)
        return clamped
      })

    // Door Lock
    const doorLock = this.accessory!.getService('Washer Door Lock') ?? this.accessory!.addService(this.platform.Service.LockMechanism, 'Washer Door Lock', 'WasherDoorLock')
    doorLock.setCharacteristic(this.platform.Characteristic.Name, 'Washer Door Lock')
    doorLock
      .getCharacteristic(this.platform.Characteristic.LockCurrentState)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.LAUNDRY_DOOR_LOCK)
        // 0=unlocked, 1=locked
        return r && Number.parseInt(r) === 1
          ? this.platform.Characteristic.LockCurrentState.SECURED
          : this.platform.Characteristic.LockCurrentState.UNSECURED
      })

    doorLock
      .getCharacteristic(this.platform.Characteristic.LockTargetState)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.LAUNDRY_DOOR_LOCK)
        return r && Number.parseInt(r) === 1
          ? this.platform.Characteristic.LockTargetState.SECURED
          : this.platform.Characteristic.LockTargetState.UNSECURED
      })

    // Door Sensor
    const doorSensor = this.accessory!.getService('Washer Door') ?? this.accessory!.addService(this.platform.Service.ContactSensor, 'Washer Door', 'WasherDoor')
    doorSensor.setCharacteristic(this.platform.Characteristic.Name, 'Washer Door')
    doorSensor
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.LAUNDRY_DOOR)
        // 0=closed, 1=open
        return r && Number.parseInt(r) === 1
          ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
      })

    // Cycle Name (using a StatelessProgrammableSwitch to display cycle info)
    // We'll map cycle codes to readable names
    const cycleCodeToName = (code: number): string => {
      const cycleMap: { [key: number]: string } = {
        0: 'Not Defined',
        1: 'Basket Clean',
        2: 'Drain And Spin',
        3: 'Quick Rinse',
        4: 'Bulky Items',
        5: 'Sanitize',
        6: 'Towels/Sheets',
        7: 'Steam Refresh',
        8: 'Normal/Mixed',
        9: 'Whites',
        10: 'Dark Colors',
        11: 'Jeans',
        12: 'Hand Wash',
        13: 'Delicates',
        14: 'Speed Wash',
        15: 'Heavy Duty',
        16: 'Allergen',
        17: 'Power Clean',
        18: 'Rinse And Spin',
        19: 'Single Item',
        20: 'Colors',
        21: 'Cold Wash',
        22: 'Water Station',
        23: 'Tub Clean',
        24: 'Casuals With Steam',
        25: 'Stain Wash',
        26: 'Deep Clean',
        27: 'Bulky Bedding',
        28: 'Normal',
        29: 'Quick Wash',
        30: 'Sanitize With Oxi',
        31: 'Self Clean',
        32: 'Towels',
        33: 'Soak',
        34: 'Wool',
      }
      return cycleMap[code] || `Cycle ${code}`
    }

    // Create a motion sensor to show cycle status
    const cycleSensor = this.accessory!.getService('Cycle Status') ?? this.accessory!.addService(this.platform.Service.MotionSensor, 'Cycle Status', 'WasherCycle')
    cycleSensor.setCharacteristic(this.platform.Characteristic.Name, 'Cycle Status')
    cycleSensor
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(async () => {
        const cycleCode = await this.readErd(ERD_TYPES.LAUNDRY_CYCLE)
        const subCycleCode = await this.readErd(ERD_TYPES.LAUNDRY_SUB_CYCLE)

        if (cycleCode && cycleCode !== '00') {
          const code = Number.parseInt(cycleCode, 16)
          const cycleName = cycleCodeToName(code)

          const subCycleMap: { [key: number]: string } = {
            0: 'None',
            1: 'Fill',
            2: 'Soak',
            3: 'Wash',
            4: 'Rinse',
            5: 'Spin',
            6: 'Drain',
            7: 'Extra Spin',
            8: 'Extra Rinse',
          }

          const subCode = subCycleCode ? Number.parseInt(subCycleCode, 16) : 0
          const subCycleName = subCycleMap[subCode] || ''

          this.infoLog(`Washer Cycle: ${cycleName}${subCycleName !== 'None' ? ` - ${subCycleName}` : ''}`)
          return true // Motion detected when cycle is running
        }
        return false
      })
  }
}
