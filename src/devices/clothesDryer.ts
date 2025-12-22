import type { CharacteristicValue, PlatformAccessory } from 'homebridge'

import type { SmartHqContext } from '../interfaces/SmartHqContext'

import { deviceBase } from './device'

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
    accessory.context.device.features.forEach((feature: string) => {
      switch (feature) {
        case 'CLOTHES_DRYER_V1_FOUNDATION': {
          const dryer = this.accessory.getService(accessory.displayName) ?? this.accessory.addService(this.platform.Service.Switch, accessory.displayName, 'Clothes Dryer')
          dryer.getCharacteristic(this.platform.Characteristic.On)
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
    // Implement API call to get dryer state
    return this.ClothesDryer?.On ?? false
  }

  async handleSetOn(value: CharacteristicValue): Promise<void> {
    // Implement API call to set dryer state
    this.ClothesDryer.On = value
  }
}
