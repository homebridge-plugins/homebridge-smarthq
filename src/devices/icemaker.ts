import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import axios from 'axios'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'
import { interval, skipWhile } from 'rxjs'

import { Perms, Units, Formats } from 'hap-nodejs'

export class SmartHQIceMaker extends deviceBase {
  private opalProductionLimit: number = 100
  private oimPowerSvcName = 'Opal Power'
  private oimProgressSvcName = 'Opal Progress'
  private oimNightlightSvcName = 'Opal Nightlight'
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

    const opalIceMakerPowerService = this.accessory.getService(this.oimPowerSvcName) ?? this.accessory.addService(this.platform.Service.Switch, this.oimPowerSvcName, 'opal-power')

    opalIceMakerPowerService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.readErd(ERD_TYPES.OIM_POWER).then(r => Number.parseInt(r) !== 0))
      .onSet(value => this.writeErd(ERD_TYPES.OIM_POWER, value as boolean))

    const lightbulb = this.accessory.getService(this.oimNightlightSvcName)
      || this.accessory.addService(this.platform.Service.Lightbulb, this.oimNightlightSvcName)

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
    // Opal Progress service
    const opalProgressSvc = this.accessory.getService(this.oimProgressSvcName)
      || this.accessory.addService(this.platform.Service.Fanv2, this.oimProgressSvcName);


    opalProgressSvc.getCharacteristic(this.platform.Characteristic.Active)
      .setProps({
        // Omit PAIRED_WRITE
        perms: [Perms.EVENTS, Perms.PAIRED_READ]
      })

    opalProgressSvc.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps(
        {
          format: Formats.INT,
          unit: Units.PERCENTAGE,
          minStep: 1,
          minValue: 0,
          maxValue: 100,
          perms: [Perms.EVENTS, Perms.PAIRED_READ],
        }
      )
      .removeOnGet()
      .removeOnSet()

    // Get default accessory information service
    const opalIceMakerMetadataService = this.accessory.getService('')
    // Metadata for Device Form, Opal Production Limit
    opalIceMakerMetadataService
      ?.getCharacteristic(this.platform.Characteristic.ProductData)
      .onGet(() => 'l=Production_Limit&i=OPL&t=number&d=100')

    // Start an update interval
    interval(this.deviceRefreshRate * 1000)
      .pipe(skipWhile(() => !this.accessory.services.find((svc) => svc.displayName === this.oimProgressSvcName)))
      .subscribe(async () => {
        const currentProductionValue = await this.getProductionValue()

        const oimPowerSvc = this.accessory.services.find((accSvc) => accSvc.displayName === this.oimPowerSvcName);
        const oimProgressSvc = this.accessory.services.find((accSvc) => accSvc.displayName === this.oimProgressSvcName)

        const determinedProductionValue = Math.ceil(100 / this.opalProductionLimit) * currentProductionValue

        oimProgressSvc?.updateCharacteristic(this.platform.Characteristic.RotationSpeed, Math.min(determinedProductionValue, 100))
        oimProgressSvc?.updateCharacteristic(this.platform.Characteristic.Active, currentProductionValue > 0 ? 1 : 0)

        if (currentProductionValue >= this.opalProductionLimit) {
          oimPowerSvc?.setCharacteristic(this.platform.Characteristic.On, false)
        }
      })
  }

  private async getProductionValue(): Promise<number> {
    try {
      const erdVal = await this.readErd(ERD_TYPES.OIM_PRODUCTION);
      const productionValue = Math.min(Buffer.from(erdVal, 'hex').readUInt8(0), 100)

      this.infoLog(`productionValue: ${productionValue}, opl: ${this.opalProductionLimit}`)
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
}


