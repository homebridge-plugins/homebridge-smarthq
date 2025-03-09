import type { PlatformAccessory } from 'homebridge'
import type { Subscription } from 'rxjs'
import { timer, Observable, concat, of } from 'rxjs'
import { switchMap, skipWhile } from 'rxjs'

import { SmartHQIceMaker } from '@opal/index.js'
import type { SmartHQPlatform, devicesConfig, SmartHqContext } from '@root'
import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'

export class OpalMonitorManager extends OpalDeviceBase {
  private servicesSubscription: Subscription | null = null
  private schedulerSubscription: Subscription | null = null
  private statusSubscription: Subscription | null = null
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

  private getTimeUntilNextMinute(): number {
    const now = new Date()
    const remaining = (60 - now.getSeconds()) * 1000 - now.getMilliseconds()
    return remaining > 0 ? remaining : 0
  }

  // Create a timer that aligns with the minute boundary and executes immediately at alignment
  private createMinuteAlignedTimer(intervalMs: number): Observable<number> {
    return timer(this.getTimeUntilNextMinute()).pipe(
      // Start with an immediate emission, then continue with regular interval
      switchMap(() => concat(
        of(0), // Emit 0 immediately when the timer reaches alignment
        timer(intervalMs, intervalMs)
      ))
    )
  }

  // Start the monitoring
  startServicesMonitoring(): void {
    // Stop any existing subscription first
    this.stopServicesMonitoring()

    const refreshRate = (this.platform.config.options?.refreshRate || 30) * 1000

    this.servicesSubscription =
      this.createMinuteAlignedTimer(refreshRate)
        .pipe(
          skipWhile(() => !this.opalIceMaker.progressManager && !this.platform.config.options?.homekitControllerNotificationsSecret)
        )
        .subscribe(async () => {
          try {
            this.platform.debugLog('Running opal services monitoring tasks')
            // These Notifications only alert in Homekit Controller
            await this.opalIceMaker.filterMaintenanceManager.getFilterMaintenanceStatus()
            await this.opalIceMaker.descaleManager.getDescaleStatus()

            if (this.opalIceMaker.progressManager?.hasService()) {
              const currentProductionValue = await this.opalIceMaker.progressManager.processProductionProgress()
              this.opalIceMaker.powerManager.turnOffOnProductionLimitSurpassed(currentProductionValue)
            }
          } catch (error) {
            this.platform.errorLog(`Error in service monitoring: ${error}`)
          }
        })

    this.platform.debugLog(`Opal services monitor starting in ${this.getTimeUntilNextMinute() / 1000} seconds, Interval: ${refreshRate / 1000} seconds`)
  }

  startStatusMonitoring(): void {
    this.stopStatusMonitoring()

    const refreshRate = (this.platform.config.options?.refreshRate || 30) * 1000

    this.statusSubscription =
      this.createMinuteAlignedTimer(refreshRate)
        .subscribe(async () => {
          try {
            this.platform.debugLog('Running opal status monitoring tasks')
            await this.opalIceMaker.statusManager.getOpalCurrentStatus()
          } catch (error) {
            this.platform.errorLog(`Error in status monitoring: ${error}`)
          }
        })

    this.platform.debugLog(`Opal status monitor starting in ${this.getTimeUntilNextMinute() / 1000} seconds, Interval: ${refreshRate / 1000} seconds`)
  }

  startSchedulerMonitoring(): void {
    this.stopSchedulerMonitoring()

    const schedulingInterval = this.opalIceMaker.schedulingManager.schedulerInterval
    this.schedulerSubscription = this.createMinuteAlignedTimer(schedulingInterval)
      .pipe(
        skipWhile(() => !this.platform.config.deviceOptions?.opal?.oplIceProductionSchedule)
      )
      .subscribe(() => {
        try {
          this.platform.debugLog('Running opal scheduler monitoring tasks')
          this.opalIceMaker.schedulingManager.initializeIfIceMakerOnSchedule()
        } catch (error) {
          this.platform.errorLog(`Error in scheduler monitoring: ${error}`)
        }
      })

    this.platform.debugLog(`Opal scheduling monitor starting in ${this.getTimeUntilNextMinute() / 1000} seconds, Interval: ${schedulingInterval / 1000} seconds`)
  }

  stopSchedulerMonitoring(): void {
    if (this.schedulerSubscription) {
      this.schedulerSubscription.unsubscribe()
      this.schedulerSubscription = null
      this.platform.debugLog('Stopped Schedule Monitoring')
    }
  }

  stopStatusMonitoring(): void {
    if (this.statusSubscription) {
      this.statusSubscription.unsubscribe()
      this.statusSubscription = null
      this.platform.debugLog('Stopped Status Monitoring')
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