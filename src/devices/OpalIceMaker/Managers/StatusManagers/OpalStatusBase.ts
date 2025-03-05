import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../../../../platform.js'
import type { devicesConfig, SmartHqContext } from '../../../../settings.js'

import { ERD_TYPES } from '../../../../settings.js'
import { OpalDeviceBase } from '../../OpalDeviceBase.js'

export class OpalStatusBase extends OpalDeviceBase {
  public OpalStatusCodes = {
    MAKING_ICE: 0,
    DEFROSTING: 1,
    CLEANING: 2,
    ICE_BIN_FULL: 3,
    ADD_WATER: 4,
    ICE_BIN_MISSING: 5,
    IDLE: 6,
    MISSING_WATER_SOURCE: 7,
    LID_OPEN: 8,
    UNKNOWN: 255,
  }
  public opalCurrentStatus: number = this.OpalStatusCodes.IDLE

  constructor(
    readonly platform: SmartHQPlatform,
    public accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
  }

  async getOpalCurrentStatus(): Promise<void> {
    const rawStatusResponse = await this.readErd(ERD_TYPES.OIM_STATUS)
    const opalIceMakerStatus = Number.parseInt(rawStatusResponse)
    this.setOpalCurrentStatus(opalIceMakerStatus)
  }

  async setOpalCurrentStatus(newStatus: number): Promise<void> {
    this.opalCurrentStatus = newStatus
    this.setChildStatus()
  }

  // This will be overridden by the child class
  setChildStatus(): void {
    // Default implementation does nothing
  }
}
