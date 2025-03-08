import type { PlatformAccessory } from 'homebridge'
import type { Subscription } from 'rxjs'

import { SmartHQIceMaker } from '@opal/index.js'
import type { SmartHQPlatform, devicesConfig, SmartHqContext } from '@root'


import { interval, skipWhile } from 'rxjs'
import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'


export class OpalMonitorManager extends OpalDeviceBase {
  private subscription: Subscription | null = null
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
  startMonitoring(): void {
    // Stop any existing subscription first
    this.stopMonitoring()

    this.subscription = interval((this.device.refreshRate || 30) * 1000)
      .pipe(skipWhile(() => !this.opalIceMaker.progressManager && !this.platform.config.options?.homekitControllerNotificationsSecret))
      .subscribe(async () => {
        await this.opalIceMaker.statusManager.getOpalCurrentStatus()
        await this.opalIceMaker.filterMaintenanceManager.getFilterMaintenaceStatus()
        await this.opalIceMaker.descaleManager.getDescaleStatus()

        if (this.opalIceMaker.progressManager?.hasService()) {
          try {
            const currentProductionValue = await this.opalIceMaker.progressManager.processProductionProgress()
            // Auto-shutoff if production exceeds limit
            if (this.opalIceMaker.progressManager.opalProductionLimit && currentProductionValue >= this.opalIceMaker.progressManager.opalProductionLimit) {
              this.opalIceMaker.powerManager.setOpalPowerState(false)
              this.platform.debugLog(`Auto-shutoff triggered: Production (${currentProductionValue}) > Limit (${this.opalIceMaker.progressManager.opalProductionLimit})`)
            }
          } catch (error) {
            const typedErr = error as { message: string }
            this.platform.errorLog(`Monitor error: ${typedErr.message}`)
          }
        }
      })

    this.platform.debugLog(`Started ice maker monitoring at ${this.device.refreshRate}s intervals`)
  }

  // Stop the monitoring
  stopMonitoring(): void {
    if (this.subscription) {
      this.subscription.unsubscribe()
      this.subscription = null
      this.platform.debugLog('Stopped ice maker monitoring')
    }
  }

  // Update monitoring rate
  updateRefreshRate(newRate: number): void {
    this.device.refreshRate = newRate
    if (this.subscription) {
      // Restart with new rate
      this.startMonitoring()
    }
  }
}
