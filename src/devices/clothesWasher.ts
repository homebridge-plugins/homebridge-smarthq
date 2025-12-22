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
    accessory.context.device.features.forEach((feature: string) => {
      if (feature === 'CLOTHES_WASHER_V1_FOUNDATION') {
        const washer = this.accessory.getService(accessory.displayName) ?? this.accessory.addService(this.platform.Service.Switch, accessory.displayName, 'Clothes Washer')
        washer.getCharacteristic(this.platform.Characteristic.On)
          .onGet(this.handleGetOn.bind(this))
          .onSet(this.handleSetOn.bind(this))
      } else {
        this.debugLog(`Feature not supported: ${feature}`)
      }
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
