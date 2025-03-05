import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../../../../platform.js'
import type { devicesConfig, SmartHqContext } from '../../../../settings.js'

import { OpalDeviceBase } from '../../OpalDeviceBase.js'

export class OpalAddWaterStatusSvcManager extends OpalDeviceBase {
  public service: Service
  private serviceName = 'Add Water Sensor'
  public AddWaterCurrentStatus = {
    WATER_OK: 0,
    ADD_WATER: 1,
  } as const
  public addWaterCurrentStatus: 0 | 1 = this.AddWaterCurrentStatus.WATER_OK

  constructor(
    platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.service = this.accessory.getService(this.serviceName)
      || this.accessory.addService(this.platform.Service.ContactSensor, this.serviceName, 'opal-add-water-sensor')

    this.service
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(() => this.addWaterCurrentStatus)
      .on('change', async (chg) => {
        if (chg.oldValue === this.AddWaterCurrentStatus.WATER_OK && chg.newValue === this.AddWaterCurrentStatus.ADD_WATER) {
          const notificationPath = this.platform.config.options?.oplHKCAddWaterNotificationPath

          if (notificationPath) {
            await this.sendHomeKitControllerNotification(notificationPath)
          }
        }
      })
  }

  setAddWaterCurrentStatus(updateValue: 0 | 1) {
    this.addWaterCurrentStatus = updateValue
    // Stimulate on change handler for native notification
    this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState).setValue(updateValue)
  }

  getService(): Service {
    return this.service
  }
}
