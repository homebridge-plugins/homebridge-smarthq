/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * oven.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import axios from 'axios'
import { interval } from 'rxjs'
import { skipWhile } from 'rxjs/operators'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

export class SmartHQRefrigerator extends deviceBase {
  // Service
  private RefrigeratorService!: Service
  private ContactSensorState!: CharacteristicValue

  // Updates
  SensorUpdateInProgress!: boolean
  deviceStatus: any

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.debugLog(`Refrigerator Features: ${JSON.stringify(accessory.context.device.features)}`)
    accessory.context.device.features.forEach((feature) => {
      switch (feature) {
        case 'DOOR_STATUS': {
          this.RefrigeratorService = this.accessory.getService(accessory.displayName)
          || this.accessory.addService(this.platform.Service.ContactSensor, accessory.displayName, 'Refrigerator')

          this.RefrigeratorService
            .getCharacteristic(this.platform.Characteristic.ContactSensorState)
            .onGet(this.getContactSensorState.bind(this))
            .onSet(this.setContactSensorState.bind(this))
          break
        }
      }
    })

    this.SensorUpdateInProgress = false

    // Retrieve initial values and update HomeKit
    this.refreshStatus()

    // Start an update interval
    interval(this.deviceRefreshRate * 1000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus()
      })
  }

  async readErd(erd: string): Promise<string> {
    const d = await axios.get(`/appliance/${this.accessory.context.device.applianceId}/erd/${erd}`)
    return String(d.data.value)
  }

  async writeErd(erd: string, value: string | boolean) {
    await axios.post(`/appliance/${this.accessory.context.device.applianceId}/erd/${erd}`, {
      kind: 'appliance#erdListEntry',
      userId: this.accessory.context.userId,
      applianceId: this.accessory.context.device.applianceId,
      erd,
      value: typeof value === 'boolean' ? (value ? '01' : '00') : value,
    })
    return undefined
  }

  /**
   * Parse the device status from the SmartHQ API
   */
  async parseStatus() {
    try {
      // On
      // this.RefrigeratorService.On = this.deviceStatus.is_on;
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
      // const status = await this.platform.client.getDeviceStatus(this.device.device_id);
      // this.deviceStatus = status;
      await this.parseStatus()
      await this.updateHomeKitCharacteristics()
    } catch (e: any) {
      await this.errorLog(`failed to update status, Error Message: ${JSON.stringify(e.message ?? e)}`)
      await this.apiError(e)
    }
  }

  async setContactSensorState(ContactSensorState: CharacteristicValue) {
    try {
      // await this.platform.client.setDeviceOn(this.device.device_id, On as boolean);
      this.ContactSensorState = ContactSensorState as boolean
    } catch (e: any) {
      await this.errorLog(`failed to setOn, Error Message: ${JSON.stringify(e.message ?? e)}`)
    }
  }

  async getContactSensorState(): Promise<CharacteristicValue> {
    try {
      // const status = await this.platform.client.getDeviceStatus(this.device.device_id);
      // this.RefrigeratorService.On = status.is_on;
      return this.ContactSensorState
    } catch (e: any) {
      await this.errorLog(`failed to getOn, Error Message: ${JSON.stringify(e.message ?? e)}`)
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    // ContactSensorState
    await this.updateCharacteristic(this.RefrigeratorService, this.platform.Characteristic.ContactSensorState, this.ContactSensorState, 'ContactSensorState')
  }

  public async apiError(e: any): Promise<void> {
    this.RefrigeratorService.updateCharacteristic(this.platform.Characteristic.ContactSensorState, e)
  }
}
