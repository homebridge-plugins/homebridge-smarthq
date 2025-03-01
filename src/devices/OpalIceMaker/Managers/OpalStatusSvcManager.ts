import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../../../platform.js'
import type { devicesConfig, SmartHqContext } from '../../../settings.js'

export class OIMStatusManager {
  private iceBucketSensor: Service
  private currentIceBucketStatus: number = 0 // 0 = not full, 1 = full

  constructor(
    readonly platform: SmartHQPlatform,
    private accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    // Create or get the occupancy sensor service
    const iceBucketSensorName = `Ice Bucket Status`
    this.iceBucketSensor = this.accessory.getService(iceBucketSensorName)
      || this.accessory.addService(this.platform.Service.OccupancySensor, iceBucketSensorName, 'ice-bucket-full')

    // Configure the occupancy sensor
    this.iceBucketSensor
      .getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .onGet(() => {
        return this.currentIceBucketStatus
      })

    // For testing purposes
    this.setupTestMode()
  }

  // Update the bucket status
  updateBucketStatus(newStatus: number): void {
    if (newStatus !== this.currentIceBucketStatus) {
      this.currentIceBucketStatus = newStatus
      this.iceBucketSensor.updateCharacteristic(
        this.platform.Characteristic.OccupancyDetected,
        this.currentIceBucketStatus,
      )
      this.platform.debugLog(`Ice bucket status updated to: ${newStatus ? 'Full' : 'Not Full'}`)
    }
  }

  // Get the service instance
  getService(): Service {
    return this.iceBucketSensor
  }

  // Setup test mode for development
  private setupTestMode(): void {
    // Test simulation - can be removed in production
    setTimeout(() => {
      this.platform.debugLog('TEST: Simulating ice bucket becoming full')
      this.updateBucketStatus(1)
    }, 30000)

    setTimeout(() => {
      this.platform.debugLog('TEST: Simulating ice bucket being emptied')
      this.updateBucketStatus(0)
    }, 60000)
  }

  // Method to check and update status from device
  async checkStatus(): Promise<void> {
    try {
      // This would be replaced with actual logic to read from your device
      // const bucketErd = await deviceApi.readBucketStatus();
      // this.updateBucketStatus(bucketErd === '01' ? 1 : 0);
    } catch (error) {
      const typedErr = error as { message: string }
      this.platform.errorLog(`Failed to check ice bucket status: ${typedErr.message}`)
    }
  }
}
