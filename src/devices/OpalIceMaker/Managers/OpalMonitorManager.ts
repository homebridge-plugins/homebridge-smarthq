import type { PlatformAccessory } from 'homebridge'
import type { Subscription } from 'rxjs'

import { SmartHQIceMaker } from '@opal/index.js'
import type { SmartHQPlatform, devicesConfig, SmartHqContext } from '@root'


import { interval, skipWhile } from 'rxjs'
import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'


export class OpalMonitorManager extends OpalDeviceBase {
  private servicesSubscription: Subscription | null = null
  private schedulerSubscription: Subscription | null = null
  public opalIceMaker: SmartHQIceMaker

  constructor(
    opalIceMaker: SmartHQIceMaker,
    readonly platform: SmartHQPlatform,
    public accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.opalIceMaker = opalIceMaker
  }

  // Start the monitoring
  startServicesMonitoring(): void {
    // Stop any existing subscription first
    this.stopServicesMonitoring()
    this.stopSchedulerMonitoring()

    this.servicesSubscription = interval((this.device.refreshRate || 30) * 1000)
      .pipe(skipWhile(() => !this.opalIceMaker.progressManager && !this.platform.config.options?.homekitControllerNotificationsSecret))
      .subscribe(async () => {
        await this.opalIceMaker.statusManager.getOpalCurrentStatus()
        await this.opalIceMaker.filterMaintenanceManager.getFilterMaintenanceStatus()
        await this.opalIceMaker.descaleManager.getDescaleStatus()
        if (this.opalIceMaker.progressManager?.hasService()) {
          const currentProductionValue = await this.opalIceMaker.progressManager.processProductionProgress()
          this.opalIceMaker.powerManager.turnOffOnProductionLimitSurpassed(currentProductionValue)
        }
      })
    this.platform.debugLog(`Started ice maker monitoring at ${this.device.refreshRate}s intervals`)
  }

  startSchedulerMonitoring(): void {
    this.schedulerSubscription = interval(this.opalIceMaker.schedulingManager.schedulerInterval)
      .pipe(skipWhile(() => !this.platform.config.deviceOptions?.opal?.oplIceProductionSchedule))
      .subscribe(() => {
        this.opalIceMaker.schedulingManager.initializeIfIceMakerOnSchedule()
      })

    this.platform.debugLog(`Started ice maker monitoring at 60s intervals`)
  }

  stopSchedulerMonitoring(): void {
    if (this.schedulerSubscription) {
      this.schedulerSubscription.unsubscribe()
      this.schedulerSubscription = null
      this.platform.debugLog('Stopped Schedule Monitoring')
    }
  }

  // Stop the monitoring
  stopServicesMonitoring(): void {
    if (this.servicesSubscription) {
      this.servicesSubscription.unsubscribe()
      this.servicesSubscription = null
      this.platform.debugLog('Stopped ice maker monitoring')
    }
  }
}
