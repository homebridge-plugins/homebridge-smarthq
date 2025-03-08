import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQIceMaker } from '@opal/index.js'
import type { SmartHQPlatform } from '@root'
import type { devicesConfig, SmartHqContext } from '@root'

import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'

export class OpalAddWaterStatusSvcManager extends OpalDeviceBase {
  public service: Service
  public opalIceMaker: SmartHQIceMaker
  private serviceName = 'Opal Add Water Sensor'
  private configuredName = 'Add Water'
  public advancedOptionQueryStrs = ['device=opal&label=HKC_Add_Water_Notification_Path&indicator=oplHKCAddWaterNotificationPath']
  public AddWaterCurrentStatus = {
    WATER_OK: 0,
    ADD_WATER: 1,
  } as const
  public addWaterCurrentStatus: 0 | 1 = this.AddWaterCurrentStatus.WATER_OK

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

  private createService(): Service {
    // Check if service already exists
    const existingService = this.accessory.getService(this.serviceName)

    // Remove existing service if it exists
    if (existingService) {
      this.accessory.removeService(existingService)
    }

    const service = this.accessory.addService(this.platform.Service.ContactSensor, this.serviceName, 'opal-add-water-sensor')

    service
      .getCharacteristic(this.platform.Characteristic.ConfiguredName)
      .onGet(() => this.configuredName)
      .setValue(this.configuredName)

    service
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(() => this.addWaterCurrentStatus)
      .on('change', async (chg) => {
        if (chg.oldValue === this.AddWaterCurrentStatus.WATER_OK && chg.newValue === this.AddWaterCurrentStatus.ADD_WATER) {
          const notificationPath = this.platform.config.deviceOptions?.opal?.oplHKCAddWaterNotificationPath

          if (notificationPath) {
            await this.sendHomeKitControllerNotification(notificationPath)
          }
        }
      })

    return service

  }

  setAddWaterCurrentStatus(updateValue: 0 | 1) {
    this.addWaterCurrentStatus = updateValue
    // Stimulate on change handler for native notification
    this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState).setValue(updateValue)

    if (updateValue === this.AddWaterCurrentStatus.ADD_WATER && this.platform.config.deviceOptions?.opal?.oplAutoShutoffOnBlockingEvent === true) {
      this.opalIceMaker.powerManager.setOpalPowerState(false)
    }
  }

  getService(): Service {
    return this.service
  }
}
