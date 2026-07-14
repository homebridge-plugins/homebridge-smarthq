import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { interval, skipWhile } from 'rxjs'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

export class SmartHQClothesWasher extends deviceBase {
  // Updates
  SensorUpdateInProgress!: boolean
  deviceStatus: any

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.debugLog(`Clothes Washer Features: ${JSON.stringify(accessory.context.device.features)}`)

    // Washer Running State (Valve)
    const washerValve = this.accessory.getService('Washer') ?? this.accessory.addService(this.platform.Service.Valve, 'Washer', 'Washer')
    washerValve.setCharacteristic(this.platform.Characteristic.Name, 'Washer')
    washerValve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)
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
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.LAUNDRY_TIME_REMAINING)
        if (!r) {
          return 0
        }
        // Value is in hex, convert to decimal (appears to be in deciseconds or needs /10)
        const value = Number.parseInt(r, 16)
        const minutes = value / 10
        const seconds = Math.min(minutes * 60, 3600) // Cap at 3600 seconds (HomeKit max)
        this.infoLog(`Time Remaining - Hex: ${r}, Decimal: ${value}, Minutes: ${minutes}, Seconds: ${seconds}`)
        return seconds
      })

    // Door Lock
    const doorLock = this.accessory.getService('Washer Door Lock') ?? this.accessory.addService(this.platform.Service.LockMechanism, 'Washer Door Lock', 'WasherDoorLock')
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
    const doorSensor = this.accessory.getService('Washer Door') ?? this.accessory.addService(this.platform.Service.ContactSensor, 'Washer Door', 'WasherDoor')
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
    const cycleSensor = this.accessory.getService('Cycle Status') ?? this.accessory.addService(this.platform.Service.MotionSensor, 'Cycle Status', 'WasherCycle')
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

    // this is subject we use to track when we need to POST changes to the SmartHQ API
    this.SensorUpdateInProgress = false

    // Start an update interval
    interval(this.deviceRefreshRate * 10000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(async () => {
        // await this.refreshStatus()
      })
  }
}
