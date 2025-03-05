import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform, devicesConfig, SmartHqContext } from '@root'

import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'

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
    const opalProductionLimitQueryStr = 'l=Production_Duration_Minutes&i=opalProductionLimit&t=number&d=0&p=Number._0_for_Infinite&de=opal'
    const opalHKCNotificationsPathQueryStr = 'l=HKC_Ice_Bucket_Full_Notification_Path&i=oplHKCIceBucketFullNotificationPath&de=opal'
    const opalHKCCompletionNotificationPathQueryStr = 'l=HKC_Progress_Complete_Notification_Path&i=oplHKCProgressCompleteNotificationPath&de=opal'
    const opalHKCFilterMaintenanceNotificationPathQueryStr = 'l=HKC_Filter_Maintenace_Notification_Path&i=oplHKCFilterMaintenanceNotificationPath&de=opal'
    const opalHKCAddWaterNotificationPathQueryStr = 'l=HKC_Add_Water_Notification_Path&i=oplHKCAddWaterNotificationPath&de=opal'

    const fullQueryStr = [
      opalProductionLimitQueryStr,
      opalHKCNotificationsPathQueryStr,
      opalHKCCompletionNotificationPathQueryStr,
      opalHKCFilterMaintenanceNotificationPathQueryStr,
      opalHKCAddWaterNotificationPathQueryStr
    ]
      .reduce((acc, qs, index) => {
        if (index === 0) {
          return acc.concat(qs)
        }
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
