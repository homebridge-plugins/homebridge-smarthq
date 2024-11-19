/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * oven.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import axios from 'axios'
import { interval, skipWhile } from 'rxjs'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

export class SmartHQRefrigerator extends deviceBase {
  // Service
  private Refrigerator!: {
    Service: Service
    Name: CharacteristicValue
    ContactSensorState: CharacteristicValue
  }

  // Updates
  SensorUpdateInProgress!: boolean
  deviceStatus: any

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.debugLog(`Dishwasher Features: ${JSON.stringify(accessory.context.device.features)}`)
    accessory.context.device.features.forEach((feature) => {
      /* [
      "DOOR_STATUS"
      ] */
      switch (feature) {
        case 'DOOR_STATUS': {
          const refrigerator
            = this.accessory.getService(accessory.displayName)
            || this.accessory.addService(this.platform.Service.ContactSensor, accessory.displayName, 'Refrigerator')

          refrigerator
            .getCharacteristic(this.platform.Characteristic.ContactSensorState)
            .onGet(() => this.readErd(ERD_TYPES.DOOR_STATUS).then(r => Number.parseInt(r) !== 0))
            .onSet(value => this.writeErd(ERD_TYPES.DOOR_STATUS, value as boolean))
          break
        }
      }
    })

    // this is subject we use to track when we need to POST changes to the SmartHQ API
    this.SensorUpdateInProgress = false

    // Retrieve initial values and updateHomekit
    this.refreshStatus()

    // Start an update interval
    interval(this.deviceRefreshRate * 10000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus()
      })
  }

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

  /**
   * Parse the device status from the SmartHQ api
   */
  async parseStatus() {
    try {
      // On
      // this.Refrigerator.On = this.deviceStatus.is_on
    } catch (e: any) {
      await this.errorLog(`failed to parseStatus, Error Message: ${JSON.stringify(e.message ?? e)}`)
      await this.apiError(e)
    }
  }

  /**
   * Asks the SmartHQ API for the latest device information
   */
  async refreshStatus() {
    try {
      // const status = await this.platform.client.getDeviceStatus(this.device.device_id)
      // this.deviceStatus = status
      await this.parseStatus()
      await this.updateHomeKitCharacteristics()
    } catch (e: any) {
      await this.errorLog(`failed to update status, Error Message: ${JSON.stringify(e.message ?? e)}`)
      await this.apiError(e)
    }
  }

  async setContactSensorState(ContactSensorState: CharacteristicValue) {
    try {
      // await this.platform.client.setDeviceOn(this.device.device_id, On as boolean)
      this.Refrigerator.ContactSensorState = ContactSensorState as boolean
    } catch (e: any) {
      await this.errorLog(`failed to setOn, Error Message: ${JSON.stringify(e.message ?? e)}`)
    }
  }

  async getContactSensorState(): Promise<CharacteristicValue> {
    try {
      // const status = await this.platform.client.getDeviceStatus(this.device.device_id)
      // this.Refrigerator.On = status.is_on
      return this.Refrigerator.ContactSensorState
    } catch (e: any) {
      await this.errorLog(`failed to getOn, Error Message: ${JSON.stringify(e.message ?? e)}`)
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    // AirQuality
    await this.updateCharacteristic(this.Refrigerator.Service, this.hap.Characteristic.ContactSensorState, this.Refrigerator.ContactSensorState, 'ContactSensorState')
  }

  public async apiError(e: any): Promise<void> {
    this.Refrigerator.Service.updateCharacteristic(this.hap.Characteristic.On, e)
  }
}
