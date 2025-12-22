import type { CharacteristicValue, PlatformAccessory } from 'homebridge'

import type { SmartHqContext } from '../interfaces/SmartHqContext'

import { deviceBase } from './device'

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
      switch (feature) {
        case 'CLOTHES_WASHER_V1_FOUNDATION': {
          const washer = this.accessory.getService(accessory.displayName) ?? this.accessory.addService(this.platform.Service.Switch, accessory.displayName, 'Clothes Washer')
          washer.getCharacteristic(this.platform.Characteristic.On)
            .onGet(this.handleGetOn.bind(this))
            .onSet(this.handleSetOn.bind(this))
          break
        }
        default:
          this.debugLog(`Feature not supported: ${feature}`)
      }
    })
  }

  async handleGetOn(): Promise<CharacteristicValue> {
    // Implement API call to get washer state
    return this.ClothesWasher?.On ?? false
  }

  async handleSetOn(value: CharacteristicValue): Promise<void> {
    // Implement API call to set washer state
    this.ClothesWasher.On = value
  }
}
