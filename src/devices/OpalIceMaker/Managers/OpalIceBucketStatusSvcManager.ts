import type { devicesConfig, SmartHqContext } from '../../../settings.js'
import type { PlatformAccessory, Service, } from 'homebridge'

import type { SmartHQPlatform } from '../../../platform.js'
import { ERD_TYPES } from '../../../settings.js';

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
  UNKNOWN = 255
}

export class OpalIceBucketStatusSvcManager extends OpalDeviceBase {
  public service: Service
  private serviceName = 'Ice Bin Full'
  private currentIceBucketStatus: boolean = false

  constructor(
    platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.service = this.accessory.getService(this.serviceName)
      || this.accessory.addService(this.platform.Service.MotionSensor, this.serviceName);

    this.service
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(() => {
        return this.currentIceBucketStatus
      }).on('change', () => { }).on('characteristic-warning', () => { })

    setInterval(async () => {
      const rawStatusResponse = await this.readErd(ERD_TYPES.OIM_STATUS)
      const opalIceMakerStatus = parseInt(rawStatusResponse)
      this.platform.infoLog("OPAL ICE MAKER STATUS")
      this.platform.infoLog(opalIceMakerStatus)
      switch (opalIceMakerStatus) {
        case OpalStatusCodes.MAKING_ICE:
          this.setBucketStatus(false)
          break
        case OpalStatusCodes.ICE_BIN_FULL:
          this.setBucketStatus(true)
          break
        case OpalStatusCodes.IDLE:
          this.setBucketStatus(false)
        default:
          this.setBucketStatus(false)
          break
      }
    }, 30 * 1000);


  }

  setBucketStatus(newStatus: boolean): void {

    this.currentIceBucketStatus = newStatus
    // Update the characteristic (true = motion detected, false = no motion)
    this.service.getCharacteristic(
      this.platform.Characteristic.MotionDetected,
    ).setValue(newStatus)

    this.platform.debugLog(`Ice bin status changed to ${newStatus ? 'FULL' : 'NOT FULL'}`);

  }

  getService(): Service {
    return this.service;
  }
}