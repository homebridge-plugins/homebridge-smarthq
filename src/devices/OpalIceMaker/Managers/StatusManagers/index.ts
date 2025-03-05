import type { PlatformAccessory } from 'homebridge'
import type { SmartHQPlatform, devicesConfig, SmartHqContext } from '@root'

import { OpalIceBucketStatusSvcManager } from '@opal/Managers/StatusManagers/OpalIceBucketStatusSvcManager.js'
import { OpalStatusBase } from './OpalStatusBase.js'

export class OpalStatusSvcManager extends OpalStatusBase {
  private iceBucketStatusManager: OpalIceBucketStatusSvcManager

  constructor(
    readonly platform: SmartHQPlatform,
    public accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.iceBucketStatusManager = new OpalIceBucketStatusSvcManager(platform, accessory, device)
  }

  override setChildStatus(): void {
    if (this.opalCurrentStatus === this.OpalStatusCodes.ICE_BIN_FULL) {
      this.iceBucketStatusManager.setIceBucketFullStatus(this.iceBucketStatusManager.IceBucketFullStatus.ICE_BUCKET_FULL)
    } else {
      this.iceBucketStatusManager.setIceBucketFullStatus(this.iceBucketStatusManager.IceBucketFullStatus.ICE_BUCKET_NOT_FULL)
    }
  }
}
