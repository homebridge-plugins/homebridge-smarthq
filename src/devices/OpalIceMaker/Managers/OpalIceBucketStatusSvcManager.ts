import type { devicesConfig, SmartHqContext } from '../../../settings.js'
import type { PlatformAccessory, Service, } from 'homebridge'

import type { SmartHQPlatform } from '../../../platform.js'

import { OpalDeviceBase } from '../OpalDeviceBase.js'

export class OpalIceBucketStatusSvcManager extends OpalDeviceBase {
  public service: Service
  private serviceName = 'Ice Bin Full'
  private currentIceBucketStatus: number = 0

  constructor(
    platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.service = this.accessory.getService(this.serviceName)
      || this.accessory.addService(this.platform.Service.ContactSensor, this.serviceName);

    this.service
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(() => {
        return this.currentIceBucketStatus
      }).on('change', () => { }).on('characteristic-warning', () => { })

    setInterval(() => {
      this.setBucketStatus(1);
    }, 30000 * 4 * 15);


  }

  setBucketStatus(newStatus: number): void {

    this.currentIceBucketStatus = newStatus
    // Update the characteristic (true = motion detected, false = no motion)
    this.service.getCharacteristic(
      this.platform.Characteristic.ContactSensorState,
    ).setValue(newStatus)

    this.platform.infoLog(`Ice bin status changed to ${newStatus === 1 ? 'FULL' : 'NOT FULL'}`);
    setTimeout(() => {
      this.platform.infoLog("Resetting alert state");
      this.currentIceBucketStatus = 0
      this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState).setValue(0)
    }, 1000)

  }

  getService(): Service {
    return this.service;
  }
}