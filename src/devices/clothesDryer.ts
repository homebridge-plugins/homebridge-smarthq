import type { CharacteristicValue, PlatformAccessory } from 'homebridge'

import type { SmartHqContext } from '../settings.js'

import { deviceBase } from './device.js'

export class SmartHQClothesDryer extends deviceBase {
  private ClothesDryer!: {
    On: CharacteristicValue
  }

  constructor(
    platform: any,
    accessory: PlatformAccessory<SmartHqContext>,
    device: any,
  ) {
    super(platform, accessory, device)
    this.debugLog(`Clothes Dryer Features: ${JSON.stringify(accessory.context.device.features)}`)

    // Initialize ClothesDryer state (restore from cache if available)
    this.ClothesDryer = {
      On: accessory.context.ClothesDryer?.On ?? false,
    }

    // Dryer Running State (Valve)
    const dryerValve = this.accessory.getService('Dryer') ?? this.accessory.addService(this.platform.Service.Valve, 'Dryer', 'Dryer')
    dryerValve.setCharacteristic(this.platform.Characteristic.Name, 'Dryer')
    dryerValve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)
    dryerValve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        try {
          return this.ClothesDryer?.On ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE
        } catch (error: any) {
          this.warnLog?.(`Dryer Active error: ${error?.message ?? error}`)
          return this.platform.Characteristic.Active.INACTIVE
        }
      })
      .onSet(this.handleSetOn.bind(this))

    dryerValve
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        try {
          return this.ClothesDryer?.On ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE
        } catch (error: any) {
          this.warnLog?.(`Dryer InUse error: ${error?.message ?? error}`)
          return this.platform.Characteristic.InUse.NOT_IN_USE
        }
      })

    // Door Lock
    const doorLock = this.accessory.getService('Dryer Door Lock') ?? this.accessory.addService(this.platform.Service.LockMechanism, 'Dryer Door Lock', 'DryerDoorLock')
    doorLock.setCharacteristic(this.platform.Characteristic.Name, 'Dryer Door Lock')
    doorLock
      .getCharacteristic(this.platform.Characteristic.LockCurrentState)
      .onGet(async () => {
        try {
          // TODO: Implement door lock state when ERD available
          return this.platform.Characteristic.LockCurrentState.UNSECURED
        } catch (error: any) {
          this.warnLog?.(`Dryer Door Lock error: ${error?.message ?? error}`)
          return this.platform.Characteristic.LockCurrentState.UNSECURED
        }
      })

    doorLock
      .getCharacteristic(this.platform.Characteristic.LockTargetState)
      .onGet(async () => this.platform.Characteristic.LockTargetState.UNSECURED)
      .onSet(async (value) => {
        this.debugLog(`Dryer Door Lock set to: ${value}`)
      })
  }

  async handleGetOn(): Promise<CharacteristicValue> {
    try {
      // TODO: Replace with actual ERD code for dryer On state if available
      // const erdValue = await this.readErd(ERD_TYPES.CLOTHES_DRYER_ON)
      // return Number.parseInt(erdValue) !== 0
      return this.ClothesDryer?.On ?? false
    } catch (error: any) {
      this.warnLog?.(`ClothesDryer handleGetOn error: ${error?.message ?? error}`)
      return false
    }
  }

  async handleSetOn(value: CharacteristicValue): Promise<void> {
    try {
      // TODO: Replace with actual ERD code for dryer On state if available
      // await this.writeErd(ERD_TYPES.CLOTHES_DRYER_ON, value as boolean)
      this.ClothesDryer.On = value
      this.accessory.context.ClothesDryer = this.ClothesDryer
    } catch (error: any) {
      this.warnLog?.(`ClothesDryer handleSetOn error: ${error?.message ?? error}`)
    }
  }
}
