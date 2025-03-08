import type { PlatformAccessory, Service } from 'homebridge'
import type { SmartHQPlatform, devicesConfig, SmartHqContext } from '@root'

import { Buffer } from 'node:buffer'

import { Formats, Perms, Units } from 'hap-nodejs'

import { ERD_TYPES } from '@root'
import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'

export class OpalProgressSvcManager extends OpalDeviceBase {
  public advancedOptionQueryStrs: string[] = [
    'device=opal&label=Production_Duration_Minutes&indicator=opalProductionLimit&type=number&defaultValue=0&placeholder=Number._0_for_Infinite',
    'device=opal&label=HKC_Progress_Complete_Notification_Path&indicator=oplHKCProgressCompleteNotificationPath'
  ]
  public serviceName: string = 'Opal Progress'
  public service: Service | null = null
  private configuredName = 'Ice Progress'
  public opalProductionLimit?: number = Infinity
  constructor(
    readonly platform: SmartHQPlatform,
    public accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    if (platform.config.deviceOptions?.opal?.opalProductionLimit) {
      this.createService()
      this.opalProductionLimit = platform.config.deviceOptions.opal.opalProductionLimit
    } else {
      // If the service exists but condition is false, remove it
      const existingService = this.accessory.getService(this.serviceName)
      if (existingService) {
        this.accessory.removeService(existingService)
      }
      this.opalProductionLimit = Infinity
    }
  }

  // Create the service and configure it
  private createService(): void {
    // Check if service already exists
    const existingService = this.accessory.getService(this.serviceName)

    // Remove existing service if it exists
    if (existingService) {
      this.accessory.removeService(existingService)
    }

    // Create new service
    this.service = this.accessory.addService(this.platform.Service.Fanv2, this.serviceName)

    this.service
      .getCharacteristic(this.platform.Characteristic.ConfiguredName)
      .onGet(() => this.configuredName)
      .setValue(this.configuredName)

    // Configure Active characteristic
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .setProps({
        perms: [Perms.EVENTS, Perms.PAIRED_READ],
      })

    // Configure RotationSpeed characteristic
    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        format: Formats.INT,
        unit: Units.PERCENTAGE,
        minStep: 1,
        minValue: 0,
        maxValue: 100,
        perms: [Perms.EVENTS, Perms.PAIRED_READ],
      })
      .removeOnGet()
      .removeOnSet()
      .on('change', async (chg) => {
        if (chg.oldValue !== 100 && chg.newValue === 100) {
          const notificationPath = this.platform.config.deviceOptions?.opal?.oplHKCProgressCompleteNotificationPath
          if (notificationPath) {
            await this.sendHomeKitControllerNotification(notificationPath)
          }
        }
      })
  }

  // Update characteristics if service exists
  updateCharacteristic(characteristic: any, value: any): void {
    if (this.service) {
      this.service.updateCharacteristic(characteristic, value)
    }
  }

  // Check if service exists
  hasService(): boolean {
    return this.service !== null
  }

  // Enable/disable the service based on a new condition
  setEnabled(enabled: boolean): void {
    if (enabled && !this.service) {
      this.createService()
    } else if (!enabled && this.service) {
      this.accessory.removeService(this.service)
      this.service = null
    }
  }

  public async processProductionProgress() {
    try {
      const [productionValueProgressBar, productionValueMinutes] = await this.getProductionValue()

      this.service?.updateCharacteristic(
        this.platform.Characteristic.RotationSpeed,
        Math.min(productionValueProgressBar, 100),
      )

      this.service?.updateCharacteristic(
        this.platform.Characteristic.Active,
        productionValueMinutes > 0 ? 1 : 0,
      )

      return productionValueMinutes
    } catch (err) {
      const typedErr = err as { message: string }
      this.platform.errorLog(`Monitor error: ${typedErr.message}`)
      return 0
    }
  }

  // Update production limit
  updateProductionLimit(newLimit: number): void {
    this.opalProductionLimit = newLimit
    this.platform.debugLog(`Updated production limit to: ${newLimit}`)
  }

  // Get current production value
  private async getProductionValue(): Promise<[number, number]> {
    try {
      const erdVal = await this.readErd(ERD_TYPES.OIM_PRODUCTION)
      const productionValueMinutes = Buffer.from(erdVal, 'hex').readUInt8(0)

      const completionistMsg = productionValueMinutes > 100 ? `, Completion: ${productionValueMinutes}` : ''
      this.platform.debugSuccessLog(`Production: ${productionValueMinutes}, Limit: ${this.opalProductionLimit}${completionistMsg}`)

      const productionValueProgressBar = Math.floor((100 / this.opalProductionLimit!) * productionValueMinutes)
      return [productionValueProgressBar, productionValueMinutes]
    } catch (error) {
      const typedErr = error as { message: string }
      this.platform.errorLog(`Failed to read production value: ${typedErr.message}`)
      // Default to 0 if there's an error
      return [0, 0]
    }
  }
}
