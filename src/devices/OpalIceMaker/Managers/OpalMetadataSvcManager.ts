import type { SmartHQIceMaker } from '@opal/index.js'
import type { devicesConfig, SmartHqContext, SmartHQPlatform } from '@root'
import type { PlatformAccessory, Service } from 'homebridge'

import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'

export class OpalMetadataSvcManager extends OpalDeviceBase {
  public service: Service
  private configuredName = 'Metadata'
  public opalIceMaker: SmartHQIceMaker

  constructor(
    opalIceMaker: SmartHQIceMaker,
    platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.opalIceMaker = opalIceMaker
    this.service = this.createService()
  }

  createService(): Service {
    // Check if service already exists
    const service = this.accessory.getService('')!

    service
      .getCharacteristic(this.platform.Characteristic.ConfiguredName)
      .onGet(() => this.configuredName)
      .setValue(this.configuredName)

    const fullQueryStr = [
      this.opalIceMaker.schedulingManager.advancedOptionQueryStrs,
      this.opalIceMaker.powerManager.advancedOptionQueryStrs,
      this.opalIceMaker.progressManager?.advancedOptionQueryStrs || [],
      this.opalIceMaker.statusManager.iceBucketStatusManager.advancedOptionQueryStrs,
      this.opalIceMaker.statusManager.addWaterStatusManager.advancedOptionQueryStrs,
      this.opalIceMaker.filterMaintenanceManager.advancedOptionQueryStrs,
      this.opalIceMaker.descaleManager.advancedOptionQueryStrs,
    ]
      .reduce((acc, qs, index) => {
        if (index === 0) {
          return acc.concat(qs)
        }
        return acc.concat(qs)
      }, [])
      .join(',')

    service
      .getCharacteristic(this.platform.Characteristic.ProductData)
      .onGet(() => fullQueryStr)
      .updateValue(fullQueryStr)

    return service
  }

  getService(): Service {
    return this.service
  }
}
