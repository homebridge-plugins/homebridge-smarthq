import type { PlatformAccessory, Service } from 'homebridge'
import type { SmartHQPlatform, devicesConfig, SmartHqContext } from '@root'

import { ERD_TYPES } from '@root'
import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'

export class OpalNightlightSvcManager extends OpalDeviceBase {
  private service: Service
  private serviceName = 'Opal Nightlight'

  constructor(
    platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.service = this.accessory.getService(this.serviceName)
      || this.accessory.addService(this.platform.Service.Lightbulb, this.serviceName)

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => {
        const currentLevel = await this.readErd(ERD_TYPES.OIM_LIGHT_LEVEL)
        return currentLevel !== '00' // If the level is not OFF (00), return true (ON)
      })
      .onSet(async (value) => {
        let newState: any
        const currentLevel = await this.readErd(ERD_TYPES.OIM_LIGHT_LEVEL)

        if (value) {
          // If turning the light ON, cycle through states
          if (currentLevel === '00') {
            newState = '02' // LOW
          } else if (currentLevel === '02') {
            newState = '01' // HIGH
          }
        } else {
          newState = '00' // OFF
        }

        await this.writeErd(ERD_TYPES.OIM_LIGHT_LEVEL, newState)
      })

    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .setProps({
        minValue: 0, // Minimum value for brightness (OFF)
        maxValue: 100, // Maximum value for brightness (HIGH)
        minStep: 50, // Step value (only allow OFF, LOW, and HIGH)
      })
      .onGet(async () => {
        const currentLevel = await this.readErd(ERD_TYPES.OIM_LIGHT_LEVEL)

        // Map the light level to brightness values
        if (currentLevel === '02') { // HIGH
          return 50 // Dim Brightness
        } else if (currentLevel === '01') { // LOW
          return 100 // Full Brightness
        } else {
          return 0 // OFF
        }
      })
      .onSet(async (value) => {
        let newState
        if (value === 50) {
          newState = '02' // LOW (for dim brightness)
        } else if (value === 100) {
          newState = '01' // HIGH (for full brightness)
        } else {
          newState = '00' // OFF
        }

        await this.writeErd(ERD_TYPES.OIM_LIGHT_LEVEL, newState)
      })
  }

  getService(): Service {
    return this.service
  }
}
