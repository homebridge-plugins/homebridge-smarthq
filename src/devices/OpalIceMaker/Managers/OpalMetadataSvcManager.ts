import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../../../platform.js'
import type { devicesConfig, SmartHqContext } from '../../../settings.js'

import { OpalDeviceBase } from '../OpalDeviceBase.js'

export class OpalMetadataSvcManager extends OpalDeviceBase {
  public service: Service

  constructor(
    platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    // Get default accessory information service
    this.service = this.accessory.getService('')!
    // Metadata for Device Form, Opal Production Limit
    const opalProductionLimitQueryStr = 'l=Production_Duration_Minutes&i=opalProductionLimit&t=number&d=0&p=Number._0_for_Infinite'
    const opalHKCNotificationsPathQueryStr = 'l=HKC_Ice_Bucket_Full_Notifications_Path&i=oplHKCIceBucketFullNotificationPath'
    const opalHKCCompletionNotificationPathQueryStr = 'l=HKC_Progress_Complete_Notification_Path&i=oplHKCProgressCompleteNotificationPath'

    const fullQueryStr = [opalProductionLimitQueryStr, opalHKCNotificationsPathQueryStr, opalHKCCompletionNotificationPathQueryStr]
      .reduce((acc, qs) => {
        return acc.concat(',').concat(qs)
      }, '')

    this.service
      ?.getCharacteristic(this.platform.Characteristic.ProductData)
      .onGet(() => fullQueryStr)
  }

  getService(): Service {
    return this.service
  }
}
