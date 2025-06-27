import type { PlatformAccessory } from 'homebridge'
import type { SmartHQPlatform, devicesConfig, SmartHqContext } from '@root'

import { SmartHQIceMaker } from '@opal/index.js'
import { OpalIceBucketStatusSvcManager } from '@opal/Managers/StatusManagers/OpalIceBucketStatusSvcManager.js'
import { OpalAddWaterStatusSvcManager } from '@opal/Managers/StatusManagers/OpalAddWaterStatusSvcManager.js'
import { OpalStatusBase } from './OpalStatusBase.js'

export class OpalStatusSvcManager extends OpalStatusBase {
  public iceBucketStatusManager: OpalIceBucketStatusSvcManager
  public addWaterStatusManager: OpalAddWaterStatusSvcManager
  constructor(
    public opalIceMaker: SmartHQIceMaker,
    readonly platform: SmartHQPlatform,
    public accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.iceBucketStatusManager = new OpalIceBucketStatusSvcManager(opalIceMaker, platform, accessory, device)
    this.addWaterStatusManager = new OpalAddWaterStatusSvcManager(opalIceMaker, platform, accessory, device)
  }

  override setChildStatus(): void {
    switch (this.opalCurrentStatus) {
      case (this.OpalStatusCodes.ICE_BIN_FULL):
        this.iceBucketStatusManager.setIceBucketFullStatus(this.iceBucketStatusManager.IceBucketFullStatus.ICE_BUCKET_FULL)
        break
      case (this.OpalStatusCodes.ADD_WATER):
        this.addWaterStatusManager.setAddWaterCurrentStatus(this.addWaterStatusManager.AddWaterCurrentStatus.ADD_WATER)
        break
      default:
        this.iceBucketStatusManager.setIceBucketFullStatus(this.iceBucketStatusManager.IceBucketFullStatus.ICE_BUCKET_NOT_FULL)
        this.addWaterStatusManager.setAddWaterCurrentStatus(this.addWaterStatusManager.AddWaterCurrentStatus.WATER_OK)
        break
    }
  }
}
