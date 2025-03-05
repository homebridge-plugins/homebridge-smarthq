import type { PlatformAccessory } from 'homebridge'
import type { devicesConfig, SmartHqContext, SmartHQPlatform } from '@root'

import { deviceBase } from '../../devices/device.js'

import {
  OpalProgressSvcManager,
  OpalPowerSvcManager,
  OpalMonitorManager,
  OpalMetadataSvcManager,
  OpalFilterMaintenanceSvcManager,
  OpalNightlightSvcManager
} from '@opal/Managers/index.js'
import { OpalStatusSvcManager } from '@opal/Managers/StatusManagers/index.js'


export class SmartHQIceMaker extends deviceBase {
  private powerManager: OpalPowerSvcManager
  private nightlightService: OpalNightlightSvcManager
  private statusManager: OpalStatusSvcManager
  private monitorManager: OpalMonitorManager
  private progressManager?: OpalProgressSvcManager
  private metadataManager: OpalMetadataSvcManager
  private filterMaintenanceManager: OpalFilterMaintenanceSvcManager

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.platform.debugSuccessLog(`Opal IceMaker Features: ${JSON.stringify(accessory.context.device.features)}`)

    this.metadataManager = new OpalMetadataSvcManager(platform, accessory, device)

    this.progressManager = new OpalProgressSvcManager(
      platform,
      accessory,
      device,
    )

    this.filterMaintenanceManager = new OpalFilterMaintenanceSvcManager(platform, accessory, device)

    this.powerManager = new OpalPowerSvcManager(platform, accessory, device)
    this.nightlightService = new OpalNightlightSvcManager(platform, accessory, device)
    this.statusManager = new OpalStatusSvcManager(platform, accessory, device)
    this.monitorManager = new OpalMonitorManager(
      platform,
      accessory,
      device,
      this.statusManager,
      this.powerManager,
      this.progressManager,
      this.filterMaintenanceManager,
    )

    this.monitorManager.startMonitoring()
  }

  shutdown(): void {
    // Clean up subscriptions
    this.monitorManager.stopMonitoring()
  }
}
