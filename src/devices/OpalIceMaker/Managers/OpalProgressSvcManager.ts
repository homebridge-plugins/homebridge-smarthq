import type { PlatformAccessory, Service } from 'homebridge'
import type { SmartHQPlatform } from '../../../platform.js'
import type { devicesConfig, SmartHqContext } from '../../../settings.js'
import { Formats, Perms, Units } from 'hap-nodejs'

export class OpalProgressSvcManager {
  public serviceName: string = 'Opal Progress'
  public service: Service | null = null;

  constructor(
    readonly platform: SmartHQPlatform,
    private accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
    readonly condition: boolean = true
  ) {
    if (condition) {
      this.createService();
    } else {
      // If the service exists but condition is false, remove it
      const existingService = this.accessory.getService(this.serviceName);
      if (existingService) {
        this.accessory.removeService(existingService);
      }
    }
  }

  // Create the service and configure it
  private createService(): void {
    // Check if service already exists
    const existingService = this.accessory.getService(this.serviceName);

    // Remove existing service if it exists
    if (existingService) {
      this.accessory.removeService(existingService);
    }

    // Create new service
    this.service = this.accessory.addService(this.platform.Service.Fanv2, this.serviceName);

    // Configure Active characteristic
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .setProps({
        perms: [Perms.EVENTS, Perms.PAIRED_READ],
      });

    // Configure RotationSpeed characteristic
    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        format: Formats.INT,
        unit: Units.PERCENTAGE,
        minStep: 1,
        minValue: 0,
        maxValue: 100,
        perms: [Perms.EVENTS, Perms.PAIRED_READ],
      })
      .removeOnGet()
      .removeOnSet();
  }

  // Update characteristics if service exists
  updateCharacteristic(characteristic: any, value: any): void {
    if (this.service) {
      this.service.updateCharacteristic(characteristic, value);
    }
  }

  // Check if service exists
  hasService(): boolean {
    return this.service !== null;
  }

  // Enable/disable the service based on a new condition
  setEnabled(enabled: boolean): void {
    if (enabled && !this.service) {
      this.createService();
    } else if (!enabled && this.service) {
      this.accessory.removeService(this.service);
      this.service = null;
    }
  }
}