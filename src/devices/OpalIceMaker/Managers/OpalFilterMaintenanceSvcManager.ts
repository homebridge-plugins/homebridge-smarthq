import type { devicesConfig, SmartHqContext, SmartHQPlatform } from '@root'
import type { PlatformAccessory, Service } from 'homebridge'

import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'
import { ERD_TYPES } from '@root'

export class OpalFilterMaintenanceSvcManager extends OpalDeviceBase {
  public service: Service
  public serviceName: string = 'Opal Filter Maintenance'
  private configuredName = 'Filter Maintenance'
  public advancedOptionQueryStrs: string[] = ['device=opal&label=HKC_Filter_Maintenance_Notification_Path&indicator=oplHKCFilterMaintenanceNotificationPath']

  filterMaintenanceStatus: 0 | 1 = 0
  constructor(
    platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.service = this.createService()
  }

  async getFilterMaintenanceStatus() {
    const currentFilterStatus = await this.readErd(ERD_TYPES.OIM_FILTER_STATUS)
    if (currentFilterStatus) {
      this.setFilterMaintenanceStatus(Number.parseInt(currentFilterStatus) as 0 | 1)
    }
  }

  setFilterMaintenanceStatus(updateValue: 0 | 1) {
    this.filterMaintenanceStatus = updateValue
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

    const service = this.accessory.addService(this.platform.Service.FilterMaintenance, this.serviceName, 'filter-maintenance-status')

    service
      .getCharacteristic(this.platform.Characteristic.ConfiguredName)
      .onGet(() => this.configuredName)
      .setValue(this.configuredName)

    service
      .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(() => {
        return this.filterMaintenanceStatus
      })
      .on('change', async (chg) => {
        if (chg.oldValue === this.platform.Characteristic.FilterChangeIndication.FILTER_OK && chg.newValue === this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER) {
          const notificationPath = this.platform.config.deviceOptions?.opal?.oplHKCFilterMaintenanceNotificationPath
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
