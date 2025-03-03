import { interval, skipWhile } from 'rxjs';
import type { PlatformAccessory, Service } from 'homebridge';
import type { SmartHQPlatform } from '../../../platform.js';
import type { devicesConfig, SmartHqContext } from '../../../settings.js';
import { OpalDeviceBase } from '../OpalDeviceBase.js'
import { OpalProgressSvcManager } from '../Managers/OpalProgressSvcManager.js'
import { OpalPowerSvcManager } from "../Managers/OpalPowerSvcManager.js";
import { OpalStatusSvcManager } from '../Managers/StatusManagers/index.js'
import { Subscription } from 'rxjs';

export class OpalMonitorManager extends OpalDeviceBase {
  private subscription: Subscription | null = null;
  constructor(
    readonly platform: SmartHQPlatform,
    public accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
    private statusManager: OpalStatusSvcManager,
    private powerManager: OpalPowerSvcManager,
    private progressManager: OpalProgressSvcManager
  ) {
    super(platform, accessory, device)
  }

  // Start the monitoring
  startMonitoring(): void {
    // Stop any existing subscription first
    this.stopMonitoring();

    this.subscription = interval((this.device.refreshRate || 30) * 1000)
      .pipe(skipWhile(() => !this.progressManager && !this.platform.config.options?.homekitControllerNotificationsSecret))
      .subscribe(async () => {
        await this.statusManager.getOpalCurrentStatus()

        if (this.progressManager.hasService()) {
          try {
            const currentProductionValue = await this.progressManager.processProductionProgress()
            // Auto-shutoff if production exceeds limit
            if (this.progressManager.opalProductionLimit && currentProductionValue >= this.progressManager.opalProductionLimit) {
              this.powerManager.setOpalPowerState(false)
              this.platform.debugLog(`Auto-shutoff triggered: Production (${currentProductionValue}) > Limit (${this.progressManager.opalProductionLimit})`);
            }
          } catch (error) {
            const typedErr = error as { message: string }
            this.platform.errorLog(`Monitor error: ${typedErr.message}`);
          }
        }

      });


    this.platform.debugLog(`Started ice maker monitoring at ${this.device.refreshRate}s intervals`);
  }

  // Stop the monitoring
  stopMonitoring(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
      this.platform.debugLog('Stopped ice maker monitoring');
    }
  }

  // Update monitoring rate
  updateRefreshRate(newRate: number): void {
    this.device.refreshRate = newRate;
    if (this.subscription) {
      // Restart with new rate
      this.startMonitoring();
    }
  }
}