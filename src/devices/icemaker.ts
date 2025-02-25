import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import axios from 'axios'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

import { Formats, Perms, Service, Units } from 'hap-nodejs'

export class SmartHQIceMaker extends deviceBase {
  private productionUpdateInterval: NodeJS.Timeout | null = null;
  private opalProductionLimit: number = 100

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    if (this.platform.config.options?.OPL) {
      this.opalProductionLimit = this.platform.config.options.OPL
    }
    this.infoLog(`Opal IceMaker Features: ${JSON.stringify(accessory.context.device.features)}`)
    accessory.context.device.features.forEach((feature) => {
      switch (feature) {
        case 'OPAL_NUGGET_ICE_MAKER_V1_FOUNDATION': {
          const opalIceMakerPowerService = this.accessory.getService(`${accessory.displayName} Power`) ?? this.accessory.addService(this.platform.Service.Switch, `${accessory.displayName} Power`, 'opal-power')

          opalIceMakerPowerService
            .getCharacteristic(this.platform.Characteristic.On)
            .onGet(() => this.readErd(ERD_TYPES.OIM_POWER).then(r => Number.parseInt(r) !== 0))
            .onSet(value => this.writeErd(ERD_TYPES.OIM_POWER, value as boolean))

          const lightbulb = this.accessory.getService(`${accessory.displayName} Nightlight`)
            || this.accessory.addService(this.platform.Service.Lightbulb, `${accessory.displayName} Nightlight`)

          lightbulb.getCharacteristic(this.platform.Characteristic.On)
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
              this.debugLog(`Light state changed to: ${newState}`)
            })

          lightbulb.getCharacteristic(this.platform.Characteristic.Brightness)
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
              this.debugLog(`Light brightness changed to: ${newState}`)
            })
          // Ice Production
          const iceProgressServiceName = 'Icemaker Progress Service';
          const iceProgressService = this.accessory.getService(iceProgressServiceName)
            || this.accessory.addService(this.platform.Service.Fanv2, iceProgressServiceName);
          iceProgressService.getCharacteristic(this.platform.Characteristic.Active)
            .setProps({
              perms: [Perms.PAIRED_READ, Perms.TIMED_WRITE]
            })

          iceProgressService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
            .setProps(
              {
                format: Formats.INT,
                unit: Units.PERCENTAGE,
                minValue: 0,
                maxValue: 100,
                minStep: 100 / (this.opalProductionLimit || 100),
                perms: [Perms.PAIRED_READ, Perms.TIMED_WRITE],
              }
            )
            .onGet(async () => {
              return await this.getProductionValue(iceProgressService);
            }).onSet(() => { })

          this.productionUpdateInterval = setInterval(async () => {
            const currentProductionValue = await this.getProductionValue(iceProgressService);
            if (currentProductionValue >= this.opalProductionLimit) {
              opalIceMakerPowerService.setCharacteristic(this.platform.Characteristic.On, false)
            }
            // 30000ms = 30 seconds
          }, 10 * 1000);

          // // // Get default accessory information service
          const opalIceMakerMetadataService = this.accessory.getService('')
          // Metadata for Device Form, Opal Production Limit
          opalIceMakerMetadataService
            ?.getCharacteristic(this.platform.Characteristic.ProductData)
            .onGet(() => 'l=Production_Limit&i=OPL&t=number&d=100')


          break
        }
      }
    })
  }

  private async getProductionValue(iceService: Service): Promise<number> {
    try {
      const erdVal = await this.readErd(ERD_TYPES.OIM_PRODUCTION);
      const productionValue = Math.min(Buffer.from(erdVal, 'hex').readUInt8(0), 100)

      iceService.setCharacteristic(this.platform.Characteristic.Active, productionValue > 0 ? 1 : 0);

      iceService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, productionValue)
      this.infoLog(`productionValue: ${productionValue}, opl: ${this.opalProductionLimit}, minStep: ${100 / (this.opalProductionLimit || 100)}`)
      return productionValue;
    } catch (error) {
      const typedErr = error as { message: string }
      this.errorLog(`Failed to read production value: ${typedErr.message}`);
      return 0; // Default to 0 if there's an error
    }
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

  stopProductionUpdates() {
    if (this.productionUpdateInterval) {
      clearInterval(this.productionUpdateInterval);
      this.productionUpdateInterval = null;
    }
  }
}


