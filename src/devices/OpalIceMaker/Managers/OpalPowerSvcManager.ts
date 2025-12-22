import type { PlatformAccessory, Service } from 'homebridge'
import type { SmartHQPlatform, devicesConfig, SmartHqContext } from '@root'

import { ERD_TYPES } from '@root'
import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'

export class OpalPowerSvcManager extends OpalDeviceBase {
  public service: Service
  private serviceName = 'Opal Power'
  private configuredName = 'Power'
  public advancedOptionQueryStrs: string[] = ['device=opal&label=Auto_Shutoff_on_Blocking_Event&indicator=oplAutoShutoffOnBlockingEvent&type=boolean&defaultValue=false']

  constructor(
    platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.service = this.createService()
  }

  createService(): Service {
    // Check if service already exists
    const existingService = this.accessory.getService(this.serviceName)

    // Remove existing service if it exists
    if (existingService) {
      this.accessory.removeService(existingService)
    }

    const service = this.accessory.addService(this.platform.Service.Switch, this.serviceName, 'opal-power')
    service.setPrimaryService()
    service
      .getCharacteristic(this.platform.Characteristic.ConfiguredName)
      .onGet(() => this.configuredName)
      .setValue(this.configuredName)
    service
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.readErd(ERD_TYPES.OIM_POWER).then(r => r ? Number.parseInt(r) !== 0 : false))
      .onSet(value => this.writeErd(ERD_TYPES.OIM_POWER, value as boolean))

    return service

  }

  getService(): Service {
    return this.service
  }

  public setOpalPowerState(newPowerState: boolean) {
    this.service.setCharacteristic(
      this.platform.Characteristic.On,
      newPowerState,
    )
  }

  public getOpalPowerState() {
    return this.service.getCharacteristic(
      this.platform.Characteristic.On
    ).value
  }

  public turnOffOnProductionLimitSurpassed(currentProductionValue: number) {
    if (this.platform.config.deviceOptions?.opal?.opalProductionLimit && currentProductionValue >= this.platform.config.deviceOptions.opal.opalProductionLimit) {
      this.setOpalPowerState(false)
      this.platform.debugLog(`Auto-shutoff triggered: Production (${currentProductionValue}) > Limit (${this.platform.config.deviceOptions.opal.opalProductionLimit})`)
    }
  }
}
