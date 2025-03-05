import type { PlatformAccessory, Service } from 'homebridge'
import type { SmartHQPlatform, devicesConfig, SmartHqContext } from '@root'

import { ERD_TYPES } from '@root'
import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'

export class OpalPowerSvcManager extends OpalDeviceBase {
  public service: Service
  private serviceName = 'Opal Power'

  constructor(
    platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.service = this.accessory.getService(this.serviceName)
      || this.accessory.addService(this.platform.Service.Switch, this.serviceName, 'opal-power')

    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.readErd(ERD_TYPES.OIM_POWER).then(r => Number.parseInt(r) !== 0))
      .onSet(value => this.writeErd(ERD_TYPES.OIM_POWER, value as boolean))
  }

  getService(): Service {
    return this.service
  }

  public setOpalPowerState(newPowerState: boolean) {
    this.service?.setCharacteristic(
      this.platform.Characteristic.On,
      newPowerState,
    )
  }
}
