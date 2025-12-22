import type { SmartHQPlatform } from '@root'
import { ERD_TYPES, type devicesConfig, type SmartHqContext } from '@root'
import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'
import type { PlatformAccessory, Service } from 'homebridge'

export class OpalDescaleSvcManager extends OpalDeviceBase {
  public service: Service
  public advancedOptionQueryStrs: string[] = ['device=opal&label=HKC_Descale_Notification_Path&indicator=oplHKCDescaleNotificationPath']
  public serviceName: string = 'Opal Descale'
  private configuredName = 'Opal Descale'

  descaleStatus: 0 | 1 = 0
  constructor(
    platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.service = this.createService()
  }

  async getDescaleStatus() {
    const currentDescaleStatus = await this.readErd(ERD_TYPES.OIM_NEEDS_DESCALING)
    if (currentDescaleStatus) {
      this.setOpalDescaleStatus(Number.parseInt(currentDescaleStatus) as 0 | 1)
    }
  }

  setOpalDescaleStatus(updateValue: 0 | 1) {
    this.descaleStatus = updateValue
    // Stimulate on change handler for native notification
    this.service.getCharacteristic(this.platform.Characteristic.FilterChangeIndication).setValue(updateValue)
  }

  private createService(): Service {
    // Check if service already exists
    const existingService = this.accessory.getService(this.serviceName)

    // Remove existing service if it exists
    if (existingService) {
      this.accessory.removeService(existingService)
    }

    const service = this.accessory.addService(this.platform.Service.FilterMaintenance, this.serviceName, 'descale-status')

    service
      .getCharacteristic(this.platform.Characteristic.ConfiguredName)
      .onGet(() => this.configuredName)
      .setValue(this.configuredName)

    service
      .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(() => {
        return this.descaleStatus
      }).on('change', async (chg) => {
        if (chg.oldValue === this.platform.Characteristic.FilterChangeIndication.FILTER_OK && chg.newValue === this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER) {
          const notificationPath = this.platform.config.deviceOptions?.opal?.oplHKCDescaleNotificationPath
          if (notificationPath) {
            await this.sendHomeKitControllerNotification(notificationPath)
          }
        }
      })

    return service
  }
  getService(): Service {
    return this.service
  }
}
