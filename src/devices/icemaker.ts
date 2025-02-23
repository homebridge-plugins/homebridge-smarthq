import type { PlatformAccessory } from 'homebridge'

import axios from 'axios'
import type { devicesConfig, SmartHqContext } from '../settings.js'
import type { SmartHQPlatform } from '../platform.js'
import { deviceBase } from './device.js'
import { ERD_TYPES } from '../settings.js'


export class SmartHQIceMaker extends deviceBase {
  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.debugLog(`Opal IceMaker Features: ${JSON.stringify(accessory.context.device.features)}`)
    accessory.context.device.features.forEach((feature) => {
      switch (feature) {
        case 'OPAL_NUGGET_ICE_MAKER_V1_FOUNDATION': {

          const opalIceMaker = this.accessory.getService(`${accessory.displayName} Power`)
            || this.accessory.addService(this.platform.Service.Switch, `${accessory.displayName} Power`, 'opal-power')
          opalIceMaker
            .getCharacteristic(this.platform.Characteristic.On)
            .onGet(() => this.readErd(ERD_TYPES.OIM_POWER).then(r => Number.parseInt(r) !== 0))
            .onSet(value => this.writeErd(ERD_TYPES.OIM_POWER, value as boolean))


          const lightbulb = this.accessory.getService(`${accessory.displayName} Nightlight`) ||
            this.accessory.addService(this.platform.Service.Lightbulb, `${accessory.displayName} Nightlight`);

          lightbulb.getCharacteristic(this.platform.Characteristic.On)
            .onGet(async () => {
              const currentLevel = await this.readErd(ERD_TYPES.OIM_LIGHT_LEVEL);
              return currentLevel !== '00';  // If the level is not OFF (00), return true (ON)
            })
            .onSet(async (value) => {
              let newState;
              const currentLevel = await this.readErd(ERD_TYPES.OIM_LIGHT_LEVEL);

              if (value) {
                // If turning the light ON, cycle through states
                if (currentLevel === '00') {
                  newState = '02';  // LOW
                } else if (currentLevel === '02') {
                  newState = '01';  // HIGH
                }
              } else {
                newState = '00';  // OFF
              }

              await this.writeErd(ERD_TYPES.OIM_LIGHT_LEVEL, newState);
              this.debugLog(`Light state changed to: ${newState}`);
            });

          lightbulb.getCharacteristic(this.platform.Characteristic.Brightness)
            .setProps({
              minValue: 0,        // Minimum value for brightness (OFF)
              maxValue: 100,      // Maximum value for brightness (HIGH)
              minStep: 50         // Step value (only allow OFF, LOW, and HIGH)
            })
            .onGet(async () => {
              const currentLevel = await this.readErd(ERD_TYPES.OIM_LIGHT_LEVEL);

              // Map the light level to brightness values
              if (currentLevel === '02') {  // HIGH
                return 50;  // Dim Brightness
              } else if (currentLevel === '01') {  // LOW
                return 100;  // Full Brightness
              } else {
                return 0;  // OFF
              }
            })
            .onSet(async (value) => {
              let newState;
              if (value === 50) {
                newState = '02';  // LOW (for dim brightness)
              } else if (value === 100) {
                newState = '01';  // HIGH (for full brightness)
              } else {
                newState = '00';  // OFF
              }

              await this.writeErd(ERD_TYPES.OIM_LIGHT_LEVEL, newState);
              this.debugLog(`Light brightness changed to: ${newState}`);
            });

          break;
        }
      }
    })
  }

  async readErd(erd: string): Promise<string> {
    const d = await axios
      .get(`/appliance/${this.accessory.context.device.applianceId}/erd/${erd}`)
    return String(d.data.value)
  }

  async writeErd(erd: string, value: string | boolean) {
    await axios
      .post(`/appliance/${this.accessory.context.device.applianceId}/erd/${erd}`, {
        kind: 'appliance#erdListEntry',
        userId: this.accessory.context.userId,
        applianceId: this.accessory.context.device.applianceId,
        erd,
        value: typeof value === 'boolean' ? (value ? '01' : '00') : value,
      })
    return undefined
  }
}


