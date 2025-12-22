import type { CharacteristicValue, PlatformAccessory } from 'homebridge'

import type { SmartHqContext } from '../settings.js'

import { deviceBase } from './device.js'

export class SmartHQClothesWasher extends deviceBase {
  private ClothesWasher!: {
    On: CharacteristicValue
  }

  constructor(
    platform: any,
    accessory: PlatformAccessory<SmartHqContext>,
    device: any,
  ) {
    super(platform, accessory, device)
    this.debugLog(`Clothes Washer Features: ${JSON.stringify(accessory.context.device.features)}`)

    // Washer Running State (Valve)
    const washerValve = this.accessory.getService('Washer') ?? this.accessory.addService(this.platform.Service.Valve, 'Washer', 'Washer')
    washerValve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)
    washerValve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        try {
          return this.ClothesWasher?.On ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE
        } catch (error: any) {
          this.warnLog(`Washer Active error: ${error?.message ?? error}`)
          return this.platform.Characteristic.Active.INACTIVE
        }
      })
      .onSet(this.handleSetOn.bind(this))

    washerValve
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        try {
          return this.ClothesWasher?.On ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE
        } catch (error: any) {
          this.warnLog(`Washer InUse error: ${error?.message ?? error}`)
          return this.platform.Characteristic.InUse.NOT_IN_USE
        }
      })

    // Door Lock
    const doorLock = this.accessory.getService('Washer Door Lock') ?? this.accessory.addService(this.platform.Service.LockMechanism, 'Washer Door Lock', 'WasherDoorLock')
    doorLock
      .getCharacteristic(this.platform.Characteristic.LockCurrentState)
      .onGet(async () => {
        try {
          // TODO: Implement door lock state when ERD available
          return this.platform.Characteristic.LockCurrentState.UNSECURED
        } catch (error: any) {
          this.warnLog(`Washer Door Lock error: ${error?.message ?? error}`)
          return this.platform.Characteristic.LockCurrentState.UNSECURED
        }
      })

    doorLock
      .getCharacteristic(this.platform.Characteristic.LockTargetState)
      .onGet(async () => this.platform.Characteristic.LockTargetState.UNSECURED)
      .onSet(async (value) => {
        this.debugLog(`Washer Door Lock set to: ${value}`)
      })
  }

  async handleGetOn(): Promise<CharacteristicValue> {
    try {
      // TODO: Replace with actual ERD code for washer On state if available
      // const erdValue = await this.readErd(ERD_TYPES.CLOTHES_WASHER_ON)
      // return Number.parseInt(erdValue) !== 0
      return this.ClothesWasher?.On ?? false
    } catch (error: any) {
      this.warnLog(`ClothesWasher handleGetOn error: ${error?.message ?? error}`)
      return false
    }
  }

  async handleSetOn(value: CharacteristicValue): Promise<void> {
    try {
      // TODO: Replace with actual ERD code for washer On state if available
      // await this.writeErd(ERD_TYPES.CLOTHES_WASHER_ON, value as boolean)
      this.ClothesWasher.On = value
    } catch (error: any) {
      this.warnLog(`ClothesWasher handleSetOn error: ${error?.message ?? error}`)
    }
  }
}
