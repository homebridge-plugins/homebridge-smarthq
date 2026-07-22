import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

/**
 * GE all-in-one combination washer/dryer units (e.g. the Profile UltraFast
 * combo) report their appliance type as "Combination Washer Dryer" but expose
 * the exact same LAUNDRY_* ERDs as the standalone washer and dryer. A single
 * drum both washes and dries, so the cycle currently selected on the machine
 * can be either a wash cycle or a dry cycle over the one LAUNDRY_CYCLE ERD.
 *
 * The wash-cycle codes (0-34) and dry-cycle codes (128-148) are disjoint, so we
 * merge both standalone maps into one lookup and resolve whichever the machine
 * reports. Same applies to the sub-cycle codes.
 */

/**
 * Wash and dry cycle codes share the single LAUNDRY_CYCLE ERD on combo units.
 * Codes 0-34 come from the standalone washer, 128-148 from the standalone
 * dryer; the ranges don't overlap so a merged map is unambiguous.
 */
export function combinationCycleName(code: number): string {
  const cycleMap: { [key: number]: string } = {
    // Wash cycles (shared with the standalone Clothes Washer)
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
    // Dry cycles (shared with the standalone Clothes Dryer)
    128: 'Cottons',
    129: 'Easy Care',
    130: 'Active Wear',
    131: 'Timed Dry',
    132: 'Dewrinkle',
    133: 'Air Fluff',
    134: 'Steam Refresh',
    135: 'Steam Dewrinkle',
    136: 'Speed Dry',
    137: 'Mixed',
    138: 'Quick Dry',
    139: 'Casuals',
    140: 'Warm Up',
    141: 'Energy Saver',
    142: 'Antibacterial',
    143: 'Rack Dry',
    144: 'Baby Care',
    145: 'Auto Dry',
    146: 'Auto Extra',
    147: 'Perm Press',
    148: 'Washer Link',
  }
  return cycleMap[code] || `Cycle ${code}`
}

/**
 * Sub-cycle (phase) codes. Wash phases use 0-8, dry phases use 128-133; again
 * disjoint, so one merged map resolves either.
 */
export function combinationSubCycleName(code: number): string {
  const subCycleMap: { [key: number]: string } = {
    // Wash phases
    0: 'None',
    1: 'Fill',
    2: 'Soak',
    3: 'Wash',
    4: 'Rinse',
    5: 'Spin',
    6: 'Drain',
    7: 'Extra Spin',
    8: 'Extra Rinse',
    // Dry phases
    128: 'Drying',
    129: 'Mist Steam',
    130: 'Cool Down',
    131: 'Extended Tumble',
    132: 'Damp',
    133: 'Air Fluff',
  }
  return subCycleMap[code] ?? ''
}

/**
 * Machine state values follow gehome's ErdMachineState: only genuinely active
 * states count as running - standby (1) and cycle complete (4) do not (#60).
 * Exported as a pure helper so the state mapping can be unit-tested.
 */
export function isLaundryRunningState(hex: string | undefined | null): boolean {
  if (!hex) {
    return false
  }
  const state = Number.parseInt(hex, 16)
  // 2 run, 3 pause, 5/6 delay run, 7 delay pause, 8 drain timeout, 10 bulk flush
  return [2, 3, 5, 6, 7, 8, 10].includes(state)
}

export class SmartHQCombinationWasherDryer extends deviceBase {
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

    this.debugLog(`Combination Washer Dryer Features: ${JSON.stringify(accessory.context.device.features)}`)
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
      if (this.device.matterOnly) {
        this.errorLog('Matter API not available or incomplete - accessory will NOT be published (matterOnly mode enabled)')
        this.errorLog('Reason: Matter API validation failed')
        return
      }
      this.errorLog('Matter API not available or incomplete - falling back to HAP')
      this.initializeHAP()
      return
    }

    // Matter has no dedicated combo device type, so represent the unit as a
    // LaundryWasherDevice (the drum both washes and dries) with the dry cycles
    // exposed alongside the wash cycles in the mode list.
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

    // Create Matter accessory configuration with combo-specific clusters
    const matterAccessory = {
      UUID: this.matterUuid,
      displayName: this.device.nickname || 'SmartHQ Washer/Dryer',
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
          phaseList: ['Fill', 'Soak', 'Wash', 'Rinse', 'Spin', 'Drain', 'Drying', 'Cooling'],
          currentPhase: 0,
        },
        // LaundryWasher Mode cluster for cycle selection (maps to LAUNDRY_CYCLE).
        // Combines representative wash and dry cycles.
        laundryWasherMode: {
          supportedModes: [
            { label: 'Normal', mode: 0 },
            { label: 'Delicate', mode: 1 },
            { label: 'Heavy Duty', mode: 2 },
            { label: 'Whites', mode: 3 },
            { label: 'Quick Wash', mode: 4 },
            { label: 'Sanitize', mode: 5 },
            { label: 'Wash + Dry', mode: 6 },
            { label: 'Dry Only', mode: 7 },
          ],
          currentMode: 0,
        },
        // Temperature Control for water/heat temperature
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
    this.infoLog('Created Matter Washer/Dryer with operational state, mode selection, temperature control, timer, alarm, and door lock clusters')
  }

  /**
   * Machine state values follow gehome's ErdMachineState: only genuinely active
   * states count as running - standby (1) and cycle complete (4) do not (#60).
   */
  private async isMachineRunning(): Promise<boolean> {
    return isLaundryRunningState(await this.readErd(ERD_TYPES.LAUNDRY_MACHINE_STATE))
  }

  /**
   * Initialize HAP (HomeKit) protocol
   */
  private initializeHAP(): void {
    // Optional read-only running switch, a simple on/off tile for automations
    // and a clear visual in the Home app (#60)
    const existingRunningSwitch = this.accessory!.getService('Washer/Dryer Running')
    if (this.device.showRunningSwitch) {
      const runningSwitch = existingRunningSwitch ?? this.accessory!.addService(this.platform.Service.Switch, 'Washer/Dryer Running', 'WasherDryerRunning')
      runningSwitch.setCharacteristic(this.platform.Characteristic.Name, 'Washer/Dryer Running')
      runningSwitch
        .getCharacteristic(this.platform.Characteristic.On)
        .onGet(async () => {
          return this.isMachineRunning()
        })
        .onSet(async () => {
          // Read-only: snap the tile back to the machine's real state
          const running = await this.isMachineRunning()
          setTimeout(() => {
            runningSwitch.updateCharacteristic(this.platform.Characteristic.On, running)
          }, 1000)
        })
    } else if (existingRunningSwitch) {
      this.accessory!.removeService(existingRunningSwitch)
    }

    // Washer/Dryer Running State (Valve)
    const machineValve = this.accessory!.getService('Washer/Dryer') ?? this.accessory!.addService(this.platform.Service.Valve, 'Washer/Dryer', 'WasherDryer')
    machineValve.setCharacteristic(this.platform.Characteristic.Name, 'Washer/Dryer')
    machineValve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)

    // Set maximum duration to a large value (e.g., 12 hours = 43200 seconds)
    machineValve.getCharacteristic(this.platform.Characteristic.SetDuration).setProps({
      maxValue: 43200,
      minValue: 0,
      minStep: 60,
    })

    machineValve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        return await this.isMachineRunning() ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE
      })

    machineValve
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        return await this.isMachineRunning() ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE
      })

    machineValve
      .getCharacteristic(this.platform.Characteristic.RemainingDuration)
      .setProps({ maxValue: 86400 }) // default max is 3600s, laundry cycles can run longer (#60)
      .onGet(async () => {
        // Check if machine is running first
        if (!await this.isMachineRunning()) {
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
    const doorLock = this.accessory!.getService('Washer/Dryer Door Lock') ?? this.accessory!.addService(this.platform.Service.LockMechanism, 'Washer/Dryer Door Lock', 'WasherDryerDoorLock')
    doorLock.setCharacteristic(this.platform.Characteristic.Name, 'Washer/Dryer Door Lock')
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
    const doorSensor = this.accessory!.getService('Washer/Dryer Door') ?? this.accessory!.addService(this.platform.Service.ContactSensor, 'Washer/Dryer Door', 'WasherDryerDoor')
    doorSensor.setCharacteristic(this.platform.Characteristic.Name, 'Washer/Dryer Door')
    doorSensor
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.LAUNDRY_DOOR)
        // gehome ErdLaundryDoorStatus: 0=open, 1=closed, 255=unknown
        return r && Number.parseInt(r, 16) === 0
          ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
      })

    // Cycle status (motion sensor mirrors whether a wash/dry cycle is running,
    // and logs the resolved wash-or-dry cycle name)
    const cycleSensor = this.accessory!.getService('Cycle Status') ?? this.accessory!.addService(this.platform.Service.MotionSensor, 'Cycle Status', 'WasherDryerCycle')
    cycleSensor.setCharacteristic(this.platform.Characteristic.Name, 'Cycle Status')
    cycleSensor
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(async () => {
        // Motion == the machine is running (#60). Gate purely on machine state,
        // not on the cycle ERD: some combo units (observed on the V2 Profile
        // combo, appliance feature COMBINATION_WASHER_DRYER_V2_*) don't support
        // LAUNDRY_CYCLE (0x200a) at all and return a 400 for it, so keying the
        // sensor off the cycle code would leave it stuck "off" mid-cycle.
        if (!await this.isMachineRunning()) {
          return false
        }

        // Best-effort cycle/phase name for the log only (not surfaced as a
        // HomeKit value). LAUNDRY_CYCLE may be unsupported (readErd returns
        // undefined after a cached 400), in which case we fall back to the
        // sub-cycle phase, then to a plain "Running".
        const cycleCode = await this.readErd(ERD_TYPES.LAUNDRY_CYCLE)
        const subCycleCode = await this.readErd(ERD_TYPES.LAUNDRY_SUB_CYCLE)
        const cycleName = cycleCode && cycleCode !== '00' ? combinationCycleName(Number.parseInt(cycleCode, 16)) : undefined
        const subCycleName = subCycleCode ? combinationSubCycleName(Number.parseInt(subCycleCode, 16)) : ''

        const label = [cycleName, subCycleName && subCycleName !== 'None' ? subCycleName : undefined].filter(Boolean).join(' - ')
        this.infoLog(`Washer/Dryer Cycle: ${label || 'Running'}`)
        return true // Motion detected whenever the machine is running
      })
  }
}
