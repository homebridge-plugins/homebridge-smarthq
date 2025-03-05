import type { PlatformAccessory } from 'homebridge'
import type { Subscription } from 'rxjs'

import type { SmartHQPlatform, devicesConfig, SmartHqContext } from '@root'
import type { OpalFilterMaintenanceSvcManager, OpalPowerSvcManager, OpalProgressSvcManager } from '@opal/Managers/index.js'
import type { OpalStatusSvcManager } from '@opal/Managers/StatusManagers/index.js'

import { interval, skipWhile } from 'rxjs'
import { OpalDeviceBase } from '@opal/OpalDeviceBase.js'


export class OpalMonitorManager extends OpalDeviceBase {
  private subscription: Subscription | null = null
  constructor(
    readonly platform: SmartHQPlatform,
    public accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
    private statusManager: OpalStatusSvcManager,
    private powerManager: OpalPowerSvcManager,
    private progressManager: OpalProgressSvcManager,
    private filterMaintenanceManager: OpalFilterMaintenanceSvcManager,
  ) {
    super(platform, accessory, device)
  }

  // Start the monitoring
  startMonitoring(): void {
    // Stop any existing subscription first
    this.stopMonitoring()

    this.subscription = interval((this.device.refreshRate || 30) * 1000)
      .pipe(skipWhile(() => !this.progressManager && !this.platform.config.options?.homekitControllerNotificationsSecret))
      .subscribe(async () => {
        await this.statusManager.getOpalCurrentStatus()
        await this.filterMaintenanceManager.getFilterMaintenaceStatus()

        if (this.progressManager.hasService()) {
          try {
            const currentProductionValue = await this.progressManager.processProductionProgress()
            // Auto-shutoff if production exceeds limit
            if (this.progressManager.opalProductionLimit && currentProductionValue >= this.progressManager.opalProductionLimit) {
              this.powerManager.setOpalPowerState(false)
              this.platform.debugLog(`Auto-shutoff triggered: Production (${currentProductionValue}) > Limit (${this.progressManager.opalProductionLimit})`)
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
