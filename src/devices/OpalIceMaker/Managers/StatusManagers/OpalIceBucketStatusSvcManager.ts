import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../../../../platform.js'
import type { devicesConfig, SmartHqContext } from '../../../../settings.js'

import { OpalDeviceBase } from '../../OpalDeviceBase.js'

export class OpalIceBucketStatusSvcManager extends OpalDeviceBase {
  public service: Service
  private serviceName = 'Ice Bin Full'
  public IceBucketFullStatus = {
    ICE_BUCKET_NOT_FULL: 0,
    ICE_BUCKET_FULL: 1
  } as const
  public iceBucketCurrentStatus: 0 | 1 = this.IceBucketFullStatus.ICE_BUCKET_NOT_FULL

  constructor(
    platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.service = this.accessory.getService(this.serviceName)
      || this.accessory.addService(this.platform.Service.ContactSensor, this.serviceName)

    this.service
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(() => this.iceBucketCurrentStatus)
      .on('change', (chg) => {
        if (chg.oldValue === this.IceBucketFullStatus.ICE_BUCKET_NOT_FULL && chg.newValue === this.IceBucketFullStatus.ICE_BUCKET_FULL) {
          if (this.platform.config.options?.oplHKCIceBucketFullNotificationPath) {
            this.sendHomeKitControllerNotification(this.platform.config.options.oplHKCIceBucketFullNotificationPath)
          }
        }
      })
      .on('characteristic-warning', () => { })
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