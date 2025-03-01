import type { devicesConfig, SmartHqContext } from '../../../settings.js'
import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../../../platform.js'
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
    this.service
      ?.getCharacteristic(this.platform.Characteristic.ProductData)
      .onGet(() => 'l=Production_Duration_Minutes&i=OPL&t=number&d=0&p=Number,_0_for_Infinite')
  }

  getService(): Service {
    return this.service
  }
}
