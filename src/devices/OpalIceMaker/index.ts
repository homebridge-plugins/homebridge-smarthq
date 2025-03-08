import type { PlatformAccessory } from 'homebridge'
import type { devicesConfig, SmartHqContext, SmartHQPlatform } from '@root'

import { deviceBase } from '../../devices/device.js'

import {
  OpalProgressSvcManager,
  OpalPowerSvcManager,
  OpalMonitorManager,
  OpalMetadataSvcManager,
  OpalFilterMaintenanceSvcManager,
  OpalNightlightSvcManager,
  OpalDescaleSvcManager
} from '@opal/Managers/index.js'
import { OpalStatusSvcManager } from '@opal/Managers/StatusManagers/index.js'


export class SmartHQIceMaker extends deviceBase {
  public powerManager: OpalPowerSvcManager
  private nightlightService: OpalNightlightSvcManager
  public statusManager: OpalStatusSvcManager
  private monitorManager: OpalMonitorManager
  public progressManager?: OpalProgressSvcManager
  private metadataManager: OpalMetadataSvcManager
  public filterMaintenanceManager: OpalFilterMaintenanceSvcManager
  public descaleManager: OpalDescaleSvcManager

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.platform.debugSuccessLog(`Opal IceMaker Features: ${JSON.stringify(accessory.context.device.features)}`)

    /* Services- The order matters! */
    this.powerManager = new OpalPowerSvcManager(platform, accessory, device)
    this.filterMaintenanceManager = new OpalFilterMaintenanceSvcManager(platform, accessory, device)
    this.descaleManager = new OpalDescaleSvcManager(platform, accessory, device)
    this.progressManager = new OpalProgressSvcManager(
      platform,
      accessory,
      device,
    )
    this.nightlightService = new OpalNightlightSvcManager(platform, accessory, device)
    this.statusManager = new OpalStatusSvcManager(this, platform, accessory, device)
    /* -------  --------  */
    this.metadataManager = new OpalMetadataSvcManager(this, platform, accessory, device)

    this.monitorManager = new OpalMonitorManager(
      this,
      platform,
      accessory,
      device,
    )

    this.monitorManager.startMonitoring()
  }

  shutdown(): void {
    // Clean up subscriptions
    this.monitorManager.stopMonitoring()
  }
}
