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
    accessory.context.device.features.forEach((feature: string) => {
      if (feature === 'CLOTHES_DRYER_V1_FOUNDATION') {
        const dryer = this.accessory.getService(accessory.displayName) ?? this.accessory.addService(this.platform.Service.Switch, accessory.displayName, 'Clothes Dryer')
        dryer.getCharacteristic(this.platform.Characteristic.On)
          .onGet(this.handleGetOn.bind(this))
          .onSet(this.handleSetOn.bind(this))
      } else {
        this.debugLog(`Feature not supported: ${feature}`)
      }
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
    } catch (error: any) {
      this.warnLog?.(`ClothesDryer handleSetOn error: ${error?.message ?? error}`)
    }
  }
}
