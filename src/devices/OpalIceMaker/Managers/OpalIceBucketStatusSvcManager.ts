import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../../../platform.js'
import type { devicesConfig, SmartHqContext } from '../../../settings.js'

import { ERD_TYPES } from '../../../settings.js'
import { OpalDeviceBase } from '../OpalDeviceBase.js'

enum OpalStatusCodes {
  MAKING_ICE = 0,
  DEFROSTING = 1,
  CLEANING = 2,
  ICE_BIN_FULL = 3,
  ADD_WATER = 4,
  ICE_BIN_MISSING = 5,
  IDLE = 6,
  MISSING_WATER_SOURCE = 7,
  LID_OPEN = 8,
  UNKNOWN = 255,
}

enum IceBucketFullStatus {
  ICE_BUCKET_NOT_FULL = 0,
  ICE_BUCKET_FULL = 1
}

export class OpalIceBucketStatusSvcManager extends OpalDeviceBase {
  public service: Service
  private serviceName = 'Ice Bin Full'
  private opalCurrentStatus: OpalStatusCodes = OpalStatusCodes.IDLE

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
      .onGet(() => {
        return this.opalCurrentStatus === OpalStatusCodes.ICE_BIN_FULL ? IceBucketFullStatus.ICE_BUCKET_FULL : IceBucketFullStatus.ICE_BUCKET_NOT_FULL
      })
      .on('change', (chg) => {
        if (chg.newValue === IceBucketFullStatus.ICE_BUCKET_FULL) {
          if (this.platform.config.options?.oplHKCIceBucketFullNotificationPath) {
            this.sendHomeKitControllerNotification(this.platform.config.option.oplHKCIceBucketFullNotificationPath)
          }
        }
      })
      .on('characteristic-warning', () => { })
  }

  async setOpalCurrentStatus(newStatus: number): Promise<void> {
    this.opalCurrentStatus = newStatus
  }

  async getOpalCurrentStatus(): Promise<void> {
    const rawStatusResponse = await this.readErd(ERD_TYPES.OIM_STATUS)
    const opalIceMakerStatus = Number.parseInt(rawStatusResponse)
    this.setOpalCurrentStatus(opalIceMakerStatus)
  }

  getService(): Service {
    return this.service
  }
}
