import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { deviceBase } from './device.js'
import { OpalIceBucketStatusSvcManager } from './OpalIceMaker/Managers/OpalIceBucketStatusSvcManager.js'
import { OpalMetadataSvcManager } from './OpalIceMaker/Managers/OpalMetadataSvcManager.js'
import { OpalMonitorManager } from './OpalIceMaker/Managers/OpalMonitorManager.js'
import { OpalNightlightSvcManager } from './OpalIceMaker/Managers/OpalNightlightSvcManager.js'
import { OpalPowerSvcManager } from './OpalIceMaker/Managers/OpalPowerSvcManager.js'
import { OpalProgressSvcManager } from './OpalIceMaker/Managers/OpalProgressSvcManager.js'

export class SmartHQIceMaker extends deviceBase {
  private currentIceBucketStatus: number = 0
  private powerManager: OpalPowerSvcManager
  private nightlightService: OpalNightlightSvcManager
  private iceBucketStatusManager: OpalIceBucketStatusSvcManager
  private monitorManager: OpalMonitorManager
  private progressManager?: OpalProgressSvcManager
  private metadataManager: OpalMetadataSvcManager

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.debugLog(`Opal IceMaker Features: ${JSON.stringify(accessory.context.device.features)}`)

    this.metadataManager = new OpalMetadataSvcManager(platform, accessory, device)

    this.progressManager = new OpalProgressSvcManager(
      platform,
      accessory,
      device,
      !!this.platform.config.options?.OPL,
    )

    this.powerManager = new OpalPowerSvcManager(platform, accessory, device)
    this.nightlightService = new OpalNightlightSvcManager(platform, accessory, device)
    this.monitorManager = new OpalMonitorManager(
      platform,
      accessory,
      device,
      this.powerManager,
      this.progressManager,
    )

    this.iceBucketStatusManager = new OpalIceBucketStatusSvcManager(platform, accessory, device)

    this.monitorManager.startMonitoring()
  }

  shutdown(): void {
    // Clean up subscriptions
    this.monitorManager.stopMonitoring()
  }
}
