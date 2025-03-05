import type { SmartHQPlatform } from '@root'
import { ERD_TYPES, type devicesConfig, type SmartHqContext } from '@root'
import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'
import type { PlatformAccessory, Service } from 'homebridge'

export class OpalFilterMaintenanceSvcManager extends OpalDeviceBase {
  public service: Service
  public serviceName: string = 'Opal Filter Maintenance'
  filterMaintenanceStatus: 0 | 1 = 0
  constructor(
    platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.service = this.accessory.getService(this.serviceName)
      || this.accessory.addService(this.platform.Service.FilterMaintenance, this.serviceName)

    this.service.getCharacteristic(this.platform.Characteristic.FilterChangeIndication).onGet(() => {
      return this.filterMaintenanceStatus
    }).on('change', async (chg) => {
      if (chg.oldValue === this.platform.Characteristic.FilterChangeIndication.FILTER_OK && chg.newValue === this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER) {
        const notificationPath = this.platform.config.deviceOptions?.opal?.oplHKCFilterMaintenanceNotificationPath
        if (notificationPath) {
          await this.sendHomeKitControllerNotification(notificationPath)
        }
      }
    })
  }

  async getFilterMaintenaceStatus() {
    const currentFilterStatus = await this.readErd(ERD_TYPES.OIM_FILTER_STATUS)
    this.setFilterMaintenaceStatus(Number.parseInt(currentFilterStatus) as 0 | 1)
  }

  setFilterMaintenaceStatus(updateValue: 0 | 1) {
    this.filterMaintenanceStatus = updateValue
    // Stimulate on change handler for native notification
    this.service.getCharacteristic(this.platform.Characteristic.FilterChangeIndication).setValue(updateValue)
  }

  getService(): Service {
    return this.service
  }
}
