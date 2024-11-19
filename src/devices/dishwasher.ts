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

export class SmartHQDishWasher extends deviceBase {
  // Service
  private DishWasher!: {
    Service: Service
    Name: CharacteristicValue
    On: CharacteristicValue
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
      "COMMON_V1_CONTROL_LOCK",
      "COMMON_V1_SABBATH",
      "COMMON_V1_SOUND_LEVEL",
      "DISHWASHER_V1_CYCLE_DEFINITIONS",
      "DISHWASHER_V1_CYCLE_SETTINGS_BOTTLE_BLAST_OPTION",
      "DISHWASHER_V1_CYCLE_SETTINGS_DELAY_START",
      "DISHWASHER_V1_CYCLE_SETTINGS_DRY_TEMP_SELECTION",
      "DISHWASHER_V1_CYCLE_SETTINGS_SELECTED_CYCLE",
      "DISHWASHER_V1_CYCLE_SETTINGS_STEAM_OPTION",
      "DISHWASHER_V1_CYCLE_SETTINGS_WASH_TEMP_SELECTION",
      "DISHWASHER_V1_CYCLE_SETTINGS_WASH_ZONE_SELECTION",
      "DISHWASHER_V1_FOUNDATION",
      "DISHWASHER_V1_REMAINING_DELAY_START_TIME",
      "DISHWASHER_V1_REMOTE_CYCLE_CONTROL",
      "DISHWASHER_V1_SERVICE",
      "DISHWASHER_V2_SMART_ASSIST",
      "RESOURCE_MANAGEMENT_V1_ELECTRICAL_ENERGY_USAGE_V2"
      ] */
      switch (feature) {
        case 'DISHWASHER_V1_FOUNDATION': {
          const dishwasher
            = this.accessory.getService(accessory.context.device.nickname)
            || this.accessory.addService(this.platform.Service.Lightbulb, accessory.context.device.nickname, 'Dishwasher')

          dishwasher
            .getCharacteristic(this.platform.Characteristic.On)
            .onGet(() => this.readErd(ERD_TYPES.DISHWASHER_CYCLE).then(r => Number.parseInt(r) !== 0))
            .onSet(value => this.writeErd(ERD_TYPES.DISHWASHER_CYCLE, value as boolean))
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
      // this.DishWasher.On = this.deviceStatus.is_on
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

  async setOn(On: CharacteristicValue) {
    try {
      // await this.platform.client.setDeviceOn(this.device.device_id, On as boolean)
      this.DishWasher.On = On as boolean
    } catch (e: any) {
      await this.errorLog(`failed to setOn, Error Message: ${JSON.stringify(e.message ?? e)}`)
    }
  }

  async getOn(): Promise<CharacteristicValue> {
    try {
      // const status = await this.platform.client.getDeviceStatus(this.device.device_id)
      // this.DishWasher.On = status.is_on
      return this.DishWasher.On
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
    await this.updateCharacteristic(this.DishWasher.Service, this.hap.Characteristic.On, this.DishWasher.On, 'On')
  }

  public async apiError(e: any): Promise<void> {
    this.DishWasher.Service.updateCharacteristic(this.hap.Characteristic.On, e)
  }
}
