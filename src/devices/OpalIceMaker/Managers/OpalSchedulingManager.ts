import { SmartHQIceMaker } from "@opal/index.js"
import { OpalDeviceBase } from "@opal/OpalDeviceBase.js"
import { devicesConfig, SmartHqContext, SmartHQPlatform } from "@root"
import type { PlatformAccessory } from 'homebridge'

export class OpalSchedulingManager extends OpalDeviceBase {
  public opalIceMaker: SmartHQIceMaker
  public advancedOptionQueryStrs: string[] = ['device=opal&label=Opal_Ice_Production_Scheduler&indicator=oplIceProductionSchedule&type=scheduler']

  constructor(
    opalIceMaker: SmartHQIceMaker,
    readonly platform: SmartHQPlatform,
    public accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.opalIceMaker = opalIceMaker
  }

  initializeIfIceMakerOnSchedule() {
    const opalIceProductionSchedule = this.platform.config.deviceOptions?.opal?.oplIceProductionSchedule
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });

    if (opalIceProductionSchedule?.[today] && opalIceProductionSchedule?.[today].enabled) {
      const opalCurrentPowerState = this.opalIceMaker.powerManager.getOpalPowerState()
      if (opalCurrentPowerState === false) {
        const scheduledTimeStr = opalIceProductionSchedule[today].time;
        const [hours, minutes] = scheduledTimeStr.split(':');
        const scheduledTime = new Date();
        scheduledTime.setHours(hours, minutes, 0, 0)

        const now = new Date();
        const bufferTimeMilliseconds = 62 * 1000
        const triggerWindowEnd = new Date(scheduledTime.getTime() + bufferTimeMilliseconds);

        if (now >= scheduledTime && now <= triggerWindowEnd) {
          this.platform.debugSuccessLog('Turning on Ice Machine on Schedule')
          this.opalIceMaker.powerManager.setOpalPowerState(true)
        }
      }
    }
  }
}