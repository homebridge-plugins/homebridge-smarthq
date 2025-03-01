import { interval, skipWhile } from 'rxjs';
import type { PlatformAccessory, Service } from 'homebridge';
import type { SmartHQPlatform } from '../../../platform.js';
import type { devicesConfig, SmartHqContext } from '../../../settings.js';
import { ERD_TYPES } from '../../../settings.js';
import { OpalDeviceBase } from '../OpalDeviceBase.js'
import { Buffer } from 'node:buffer';
import { Subscription } from 'rxjs';

export class OpalMonitorManager extends OpalDeviceBase {
  private subscription: Subscription | null = null;
  private opalProductionLimit: number = Infinity
  constructor(
    readonly platform: SmartHQPlatform,
    public accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
    private powerManager: { service: Service },
    private progressManager: { service: Service | null }
  ) {
    super(platform, accessory, device)

    if (this.platform.config.options?.OPL) {
      this.opalProductionLimit = this.platform.config.options.OPL
    }


  }

  // Start the monitoring
  startMonitoring(): void {
    // Stop any existing subscription first
    this.stopMonitoring();

    this.subscription = interval((this.device.refreshRate || 30) * 1000)
      .pipe(skipWhile(() => !this.progressManager))
      .subscribe(async () => {
        try {
          const currentProductionValue = await this.getProductionValue();

          // Calculate progress value
          const progressBarProductionValue = Math.floor((100 / this.opalProductionLimit) * currentProductionValue);

          // Update progress service
          this.progressManager!.service?.updateCharacteristic(
            this.platform.Characteristic.RotationSpeed,
            Math.min(progressBarProductionValue, 100)
          );

          this.progressManager!.service?.updateCharacteristic(
            this.platform.Characteristic.Active,
            currentProductionValue > 0 ? 1 : 0
          );

          // Auto-shutoff if production exceeds limit
          if (currentProductionValue > this.opalProductionLimit) {
            this.powerManager.service?.setCharacteristic(
              this.platform.Characteristic.On,
              false
            );
            this.platform.debugLog(`Auto-shutoff triggered: Production (${currentProductionValue}) > Limit (${this.opalProductionLimit})`);
          }
        } catch (error) {
          const typedErr = error as { message: string }
          this.platform.errorLog(`Monitor error: ${typedErr.message}`);
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

  // Update production limit
  updateProductionLimit(newLimit: number): void {
    this.opalProductionLimit = newLimit;
    this.platform.debugLog(`Updated production limit to: ${newLimit}`);
  }

  // Get current production value
  private async getProductionValue(): Promise<number> {
    try {
      const erdVal = await this.readErd(ERD_TYPES.OIM_PRODUCTION);
      const hexToIntVal = Buffer.from(erdVal, 'hex').readUInt8(0);
      const productionValue = Math.min(hexToIntVal, 100);

      const completionistMsg = hexToIntVal > 100 ? `, Completion: ${hexToIntVal}` : '';
      this.platform.debugLog(`Production: ${productionValue}, Limit: ${this.opalProductionLimit}${completionistMsg}`);

      return productionValue;
    } catch (error) {
      const typedErr = error as { message: string }
      this.platform.errorLog(`Failed to read production value: ${typedErr.message}`);
      // Default to 0 if there's an error
      return 0;
    }
  }
}