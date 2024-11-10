/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * airqualitysensor.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { interval } from 'rxjs'
import { skipWhile } from 'rxjs/operators'

import { deviceBase } from './device.js'

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
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
    accessory: PlatformAccessory,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    // AirQuality Sensor Service
    this.debugLog('Configure AirQuality Sensor Service')
    accessory.context.DishWasher = accessory.context.DishWasher ?? {}
    this.DishWasher = {
      Name: this.accessory.displayName,
      Service: this.accessory.getService(this.hap.Service.Switch) ?? this.accessory.addService(this.hap.Service.Switch),
      On: accessory.context.On ?? this.hap.Characteristic.On,
    }
    accessory.context.DishWasher = this.DishWasher as object

    // Add AirQuality Sensor Service's Characteristics
    this.DishWasher.Service.setCharacteristic(this.hap.Characteristic.Name, this.DishWasher.Name)
      .getCharacteristic(this.hap.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this))

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

  /**
   * Parse the device status from the SmartHQ api
   */
  async parseStatus() {
    try {
      // On
      this.DishWasher.On = this.deviceStatus.is_on
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
      this.deviceStatus = status
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
