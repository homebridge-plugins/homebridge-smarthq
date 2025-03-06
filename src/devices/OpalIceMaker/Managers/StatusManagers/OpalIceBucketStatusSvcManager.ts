import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../../../../platform.js'
import type { devicesConfig, SmartHqContext } from '../../../../settings.js'

import { OpalDeviceBase } from '../../OpalDeviceBase.js'

export class OpalIceBucketStatusSvcManager extends OpalDeviceBase {
  public service: Service
  private serviceName = 'Opal Ice Bucket Full Sensor'
  private configuredName = 'Bucket Full'

  public IceBucketFullStatus = {
    ICE_BUCKET_NOT_FULL: 0,
    ICE_BUCKET_FULL: 1,
  } as const
  public iceBucketCurrentStatus: 0 | 1 = this.IceBucketFullStatus.ICE_BUCKET_NOT_FULL

  constructor(
    platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.service = this.createService()
  }

  private createService(): Service {
    // Check if service already exists
    const existingService = this.accessory.getService(this.serviceName)

    // Remove existing service if it exists
    if (existingService) {
      this.accessory.removeService(existingService)
    }

    const service = this.accessory.addService(this.platform.Service.ContactSensor, this.serviceName, 'opal-ice-bin-full-sensor')

    service
      .getCharacteristic(this.platform.Characteristic.ConfiguredName)
      .onGet(() => this.configuredName)
      .setValue(this.configuredName)

    service
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(() => this.iceBucketCurrentStatus)
      .on('change', async (chg) => {
        if (chg.oldValue === this.IceBucketFullStatus.ICE_BUCKET_NOT_FULL && chg.newValue === this.IceBucketFullStatus.ICE_BUCKET_FULL) {
          const notificationPath = this.platform.config.deviceOptions?.opal?.oplHKCIceBucketFullNotificationPath
          if (notificationPath) {
            await this.sendHomeKitControllerNotification(notificationPath)
          }
        }
      })

    return service
  }

  setIceBucketFullStatus(updateValue: 0 | 1) {
    this.iceBucketCurrentStatus = updateValue
    // Stimulate on change handler for native notification
    this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState).setValue(updateValue)
  }

  getService(): Service {
    return this.service
  }
}
