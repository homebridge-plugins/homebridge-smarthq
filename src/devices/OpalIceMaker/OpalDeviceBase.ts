import type { devicesConfig, SmartHqContext, SmartHQPlatform } from '@root'
import type { PlatformAccessory } from 'homebridge'

import axios from 'axios'

import { deviceBase } from '../device.js'

export class OpalDeviceBase extends deviceBase {
  private hkcControllerNotificationsSecret?: string
  constructor(
    readonly platform: SmartHQPlatform,
    protected accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    this.hkcControllerNotificationsSecret = this.platform.config.options?.homekitControllerNotificationsSecret
  }

  async sendHomeKitControllerNotification(hkcNotificationPath: string): Promise<void> {
    if (this.hkcControllerNotificationsSecret) {
      try {
        await axios.get(`https://api.controllerforhomekit.com/notify/${this.hkcControllerNotificationsSecret}/${hkcNotificationPath}`)
      } catch (err) {
        const typedErr = err as { message: string }
        this.platform.debugLog(typedErr.message)
      }
    }
  }
}
