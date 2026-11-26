/* Copyright(C) 2021-2026, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * coffeeMaker.ts: @homebridge-plugins/homebridge-smarthq.
 *
 * Café coffee brewers (e.g. C7CDAASP1, C7CDAASP3, #144/#152). SmartHQ reports
 * them with the type "Coffee Brewer". The ERDs are the ones simbaja/gehome
 * names for its "Cafe Coffee Maker", checked against a real C7CDAASP3 log:
 * idle 0x900B = 03C304 matched the app's strength 3, 195 °F and 4 cups, and
 * 0x9000 went 00 -> 01 and 0x9014 climbed during a brew.
 */
import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

// Placeholder services from before the brewer was supported. They never
// read anything from the machine, so they are removed.
const OLD_PLACEHOLDER_SERVICES = ['Coffee Maker', 'Water Level', 'Coffee Filter']

/** An ERD boolean: 00 is false, any other hex is true, anything else is unknown. */
export function erdFlag(value: string | undefined): boolean | undefined {
  if (!value || !/^[0-9a-f]+$/i.test(value)) {
    return undefined
  }
  return Number.parseInt(value, 16) !== 0
}

/** The current water temperature (0x9014, °F) in °C, or undefined when unknown. */
export function waterTempCelsius(value: string | undefined): number | undefined {
  if (!value || !/^[0-9a-f]{2}$/i.test(value)) {
    return undefined
  }
  const fahrenheit = Number.parseInt(value, 16)
  // gehome treats 0 as "no reading"
  if (fahrenheit === 0) {
    return undefined
  }
  return Math.round((fahrenheit - 32) * 5 / 9 * 10) / 10
}

/**
 * The value that starts a brew: the brew settings ERD, strength, temperature
 * (°F) and cups, one byte each. The machine's own settings are used, from
 * 0x900B, or from the three separate ERDs when 0x900B cannot be read.
 */
export function brewSettingsValue(
  settings: string | undefined,
  strength: string | undefined,
  temperature: string | undefined,
  cups: string | undefined,
): string | undefined {
  if (settings && /^[0-9a-f]{6}$/i.test(settings)) {
    return settings.toUpperCase()
  }
  const parts = [strength, temperature, cups]
  if (parts.every(part => part && /^[0-9a-f]{2}$/i.test(part))) {
    return parts.join('').toUpperCase()
  }
  return undefined
}

export class SmartHQCoffeeMaker extends deviceBase {
  private brewSwitch: Service
  private carafeSensor: Service
  private outOfWaterSensor: Service
  private waterTempSensor: Service

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)
    const { Characteristic, Service } = this.platform

    for (const name of OLD_PLACEHOLDER_SERVICES) {
      const old = this.accessory!.getService(name)
      if (old) {
        this.accessory!.removeService(old)
      }
    }

    // Brew: on starts a brew with the machine's own settings, off cancels it
    this.brewSwitch = this.accessory!.getService('Brew')
      ?? this.accessory!.addService(Service.Switch, 'Brew', 'CoffeeBrew')
    this.setServiceName(this.brewSwitch, 'Brew')
    this.brewSwitch.setPrimaryService(true)
    this.brewSwitch
      .getCharacteristic(Characteristic.On)
      .onGet(async () => erdFlag(await this.readErd(ERD_TYPES.CCM_IS_BREWING)) ?? false)
      .onSet(async value => this.setBrewing(Boolean(value)))

    // Carafe: detected while the pot is in place
    this.carafeSensor = this.accessory!.getService('Carafe')
      ?? this.accessory!.addService(Service.OccupancySensor, 'Carafe', 'CoffeeCarafe')
    this.setServiceName(this.carafeSensor, 'Carafe')
    this.carafeSensor
      .getCharacteristic(Characteristic.OccupancyDetected)
      .onGet(async () => this.occupancy(erdFlag(await this.readErd(ERD_TYPES.CCM_POT_PRESENT)) ?? false))

    // Out of Water: detected when the reservoir needs filling
    this.outOfWaterSensor = this.accessory!.getService('Out of Water')
      ?? this.accessory!.addService(Service.OccupancySensor, 'Out of Water', 'CoffeeOutOfWater')
    this.setServiceName(this.outOfWaterSensor, 'Out of Water')
    this.outOfWaterSensor
      .getCharacteristic(Characteristic.OccupancyDetected)
      .onGet(async () => this.occupancy(erdFlag(await this.readErd(ERD_TYPES.CCM_OUT_OF_WATER)) ?? false))

    // Water Temperature: the heater's current water temperature
    this.waterTempSensor = this.accessory!.getService('Water Temperature')
      ?? this.accessory!.addService(Service.TemperatureSensor, 'Water Temperature', 'CoffeeWaterTemp')
    this.setServiceName(this.waterTempSensor, 'Water Temperature')
    this.waterTempSensor
      .getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(async () => {
        const celsius = waterTempCelsius(await this.readErd(ERD_TYPES.CCM_CURRENT_WATER_TEMPERATURE))
        return celsius ?? this.waterTempSensor.getCharacteristic(Characteristic.CurrentTemperature).value ?? 0
      })
  }

  private occupancy(detected: boolean) {
    const { OccupancyDetected } = this.platform.Characteristic
    return detected
      ? OccupancyDetected.OCCUPANCY_DETECTED
      : OccupancyDetected.OCCUPANCY_NOT_DETECTED
  }

  async setBrewing(on: boolean): Promise<void> {
    if (!on) {
      await this.writeErd(ERD_TYPES.CCM_CANCEL_BREWING, true)
      return
    }
    const value = brewSettingsValue(
      await this.readErd(ERD_TYPES.CCM_BREW_SETTINGS),
      await this.readErd(ERD_TYPES.CCM_BREW_STRENGTH),
      await this.readErd(ERD_TYPES.CCM_BREW_TEMPERATURE),
      await this.readErd(ERD_TYPES.CCM_BREW_CUPS),
    )
    if (!value) {
      await this.warnLog('Could not start a brew: the coffee brewer did not report its brew settings')
      setTimeout(() => this.brewSwitch.updateCharacteristic(this.platform.Characteristic.On, false), 1000)
      return
    }
    await this.writeErd(ERD_TYPES.CCM_BREW_SETTINGS, value)
  }

  /** Reflect pushed ERDs in HomeKit straight away, so automations can use them. */
  onErdUpdate(erd: string, value: string): void {
    const { Characteristic } = this.platform
    switch (erd) {
      case ERD_TYPES.CCM_IS_BREWING: {
        const brewing = erdFlag(value)
        if (brewing !== undefined) {
          this.brewSwitch.updateCharacteristic(Characteristic.On, brewing)
        }
        break
      }
      case ERD_TYPES.CCM_POT_PRESENT: {
        const present = erdFlag(value)
        if (present !== undefined) {
          this.carafeSensor.updateCharacteristic(Characteristic.OccupancyDetected, this.occupancy(present))
        }
        break
      }
      case ERD_TYPES.CCM_OUT_OF_WATER: {
        const empty = erdFlag(value)
        if (empty !== undefined) {
          this.outOfWaterSensor.updateCharacteristic(Characteristic.OccupancyDetected, this.occupancy(empty))
        }
        break
      }
      case ERD_TYPES.CCM_CURRENT_WATER_TEMPERATURE: {
        const celsius = waterTempCelsius(value)
        if (celsius !== undefined) {
          this.waterTempSensor.updateCharacteristic(Characteristic.CurrentTemperature, celsius)
        }
        break
      }
    }
  }
}
