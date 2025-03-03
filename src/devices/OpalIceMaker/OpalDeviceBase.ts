import type { PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from '../../platform.js'
import type { devicesConfig, SmartHqContext } from '../../settings.js'

import axios from 'axios'

export class OpalDeviceBase {
  constructor(
    readonly platform: SmartHQPlatform,
    protected accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) { }

  // Shared utility methods
  async readErd(erd: string): Promise<string> {
    const d = await axios
      .get(`/appliance/${this.accessory.context.device.applianceId}/erd/${erd}`)
    return String(d.data.value)
  }

  async writeErd(erd: string, value: string | boolean) {
    await axios
      .post(`/appliance/${this.accessory.context.device.applianceId}/erd/${erd}`, {
        kind: 'appliance#erdListEntry',
        userId: this.accessory.context.userId,
        applianceId: this.accessory.context.device.applianceId,
        erd,
        value: typeof value === 'boolean' ? (value ? '01' : '00') : value,
      })
    return undefined
  }

  async sendHomeKitControllerNotification(hkcNotificationPath: string): Promise<void> {
    await axios.get(`https://api.controllerforhomekit.com/notify/${this.platform.config.options?.homekitControllerNotificationsSecret}/${hkcNotificationPath}`)
  }
}
