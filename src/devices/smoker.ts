/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * smoker.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'
import type { V2Service } from '../smarthqV2.js'

import { deviceBase } from './device.js'

/**
 * The Profile smoker (P9SBAAS6VBB) is the first appliance here that publishes
 * nothing usable over v1 ERDs — see the note atop smarthqV2.ts — so this device
 * reads the v2 Digital Twin API instead of the readErd/writeErd helpers every
 * other device uses. It still extends deviceBase for the accessory information,
 * logging and config plumbing.
 *
 * It is READ-ONLY. Everything worth automating on a smoker is a reading, and
 * the failure mode of a mistaken write — cancelling or re-timing somebody's
 * twelve-hour brisket — is bad enough that control should be added separately,
 * on purpose, and not inferred from a HomeKit tile someone tapped.
 *
 * ⚠️ Presentation is why the main service is a Thermostat rather than a pair of
 * sensors. Apple Home gives no tile to sensor accessories at all: temperature
 * and occupancy readings are folded into the room's status strip, so a
 * sensors-only smoker was invisible in the room grid and its occupancy services
 * additionally fed "Occupancy Detected" into the room — enough to fire an
 * unrelated occupancy automation for the length of a cook.
 *
 * A Thermostat gets a real tile showing a temperature, and every value behind
 * it is genuine: the current temperature is the meat probe, the target is the
 * cavity setpoint the active cook mode actually asked for, and the state
 * follows runStatus. The writable characteristics a Thermostat must expose are
 * answered by reverting to the appliance's real value, so the tile cannot be
 * used to change a cook by accident.
 *
 * It publishes exactly ONE service. Apple Home decides for itself which tile of
 * a multi-service accessory goes in Home View, and it favoured a flat grey
 * sensor tile over the lit thermostat regardless of setPrimaryService.
 */

/** v2 service types this device consumes. */
const SERVICE = {
  TEMPERATURE: 'cloud.smarthq.service.temperature',
  COOKING_STATE: 'cloud.smarthq.service.cooking.state.v1',
  COOKING_MODE: 'cloud.smarthq.service.cooking.mode.v1',
  TOGGLE: 'cloud.smarthq.service.toggle',
} as const

const DOMAIN = {
  MEASUREMENT: 'cloud.smarthq.domain.measurement',
  COOKING: 'cloud.smarthq.domain.cooking',
  SMOKE: 'cloud.smarthq.domain.smoke',
} as const

/**
 * The chamber and the meat probe both publish `temperature`/`measurement` with
 * an empty config; `serviceDeviceType` is the only field that separates them,
 * and only the probe is used.
 */
const OWNER = {
  PROBE: 'cloud.smarthq.device.probe',
  SMOKER: 'cloud.smarthq.device.smoker',
} as const

/** `runStatus` values seen on a live appliance. */
const RUN_STATUS_ACTIVE = 'cloud.smarthq.type.runstatus.active'

/**
 * HomeKit's CurrentTemperature defaults to 0–100°C, which a smoker sits above
 * for most of a cook: a 225°F setpoint is 107°C, so under the stock range every
 * reading pinned to 100 and the tile read a constant 212°F. HAP lets a
 * characteristic widen its own range, and Apple Home honours it — a 255°F
 * reading displayed correctly with these bounds in place.
 */
const HK_TEMP_MIN_C = -50
const HK_TEMP_MAX_C = 200

/**
 * TargetTemperature gets a deliberately tighter range than the current
 * temperature. It is a dial in Apple Home rather than a readout, and the
 * appliance only accepts 170–300°F (76.7–148.9°C), so there is nothing honest
 * to show outside these bounds.
 */
const HK_TARGET_MIN_C = 70
const HK_TARGET_MAX_C = 150

export function clampToHomeKitCelsius(celsius: number): number {
  return Math.min(HK_TEMP_MAX_C, Math.max(HK_TEMP_MIN_C, celsius))
}

export function clampToHomeKitTarget(celsius: number): number {
  return Math.min(HK_TARGET_MAX_C, Math.max(HK_TARGET_MIN_C, celsius))
}

/**
 * v2 publishes `celsiusConverted` alongside `fahrenheit`. Prefer the former and
 * fall back to converting, so a service that ships only fahrenheit still works.
 * Returns undefined for anything unreadable, so a caller can hold its last real
 * reading rather than publish a temperature nobody measured.
 */
export function readCelsius(state: Record<string, any> | undefined): number | undefined {
  if (!state) {
    return undefined
  }
  if (Number.isFinite(state.celsiusConverted)) {
    return Number(state.celsiusConverted)
  }
  if (Number.isFinite(state.fahrenheit)) {
    return ((Number(state.fahrenheit) - 32) * 5) / 9
  }
  return undefined
}

/**
 * The cavity setpoint the active cook mode is holding.
 *
 * Each preset publishes its own `cooking.mode.v1` service keyed by domainType
 * (`...cooking.food.porkrib`), and `cooking.state.v1` names which one is
 * running. Reading the setpoint off the matching preset is what makes the
 * thermostat's target a real number — 225°F for ribs — rather than a placeholder.
 */
export function cavitySetpointCelsius(
  activeMode: string | undefined,
  modes: Map<string, Record<string, any>>,
): number | undefined {
  if (!activeMode) {
    return undefined
  }
  const state = modes.get(activeMode)
  if (!state) {
    return undefined
  }
  if (Number.isFinite(state.cavityTemperatureCelsiusConverted)) {
    return Number(state.cavityTemperatureCelsiusConverted)
  }
  if (Number.isFinite(state.cavityTemperatureFahrenheit)) {
    return ((Number(state.cavityTemperatureFahrenheit) - 32) * 5) / 9
  }
  return undefined
}

export class SmartHQSmoker extends deviceBase {
  private deviceId?: string
  private unsubscribe?: () => void
  private revertTimer?: ReturnType<typeof setTimeout>

  private thermostatService?: Service

  /** Last real readings, held across a failed fetch. */
  private probeTempC?: number
  private setpointC?: number
  private cooking = false
  private smoking = false
  private activeMode?: string

  /** Every preset's published state, keyed by its domainType. */
  private cookModes = new Map<string, Record<string, any>>()

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.debugLog(`Smoker Features: ${JSON.stringify(accessory.context.device.features)}`)

    this.removeRetiredServices()

    const thermostat = this.accessory!.getService(this.platform.Service.Thermostat)
      ?? this.accessory!.addService(this.platform.Service.Thermostat, 'Smoker', 'SmokerThermostat')
    this.thermostatService = thermostat
    this.setServiceName(thermostat, 'Smoker')

    // Current is the MEAT PROBE and target is the cavity setpoint, so the tile
    // reads "156° … Heating to 225°" — both numbers the owner cares about, in
    // the order that makes them true. The chamber's own measurement is
    // deliberately not published anywhere: it runs ~30°F above setpoint during
    // the smoke phase, disagrees with the number the SmartHQ app shows, and
    // there is nothing an owner can do about it either way.
    thermostat
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({ minValue: HK_TEMP_MIN_C, maxValue: HK_TEMP_MAX_C })
      .onGet(() => clampToHomeKitCelsius(this.probeTempC ?? 0))

    // Only Off and Heat are offered: a smoker has no cooling mode to pretend at,
    // and leaving Cool/Auto in the list would put states on the tile that the
    // appliance can never be in.
    thermostat
      .getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .setProps({ validValues: [
        this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
        this.platform.Characteristic.CurrentHeatingCoolingState.HEAT,
      ] })
      .onGet(() => this.heatingState())

    thermostat
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: [
        this.platform.Characteristic.TargetHeatingCoolingState.OFF,
        this.platform.Characteristic.TargetHeatingCoolingState.HEAT,
      ] })
      .onGet(() => this.heatingState())
      .onSet(() => this.revertWrite())

    thermostat
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({ minValue: HK_TARGET_MIN_C, maxValue: HK_TARGET_MAX_C, minStep: 0.5 })
      .onGet(() => clampToHomeKitTarget(this.setpointC ?? HK_TARGET_MIN_C))
      .onSet(() => this.revertWrite())

    thermostat
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(() => this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT)

    thermostat.setPrimaryService(true)

    this.start().catch(async (error: any) => {
      await this.errorLog(`Smoker failed to start: ${error?.message ?? error}`)
    })
  }

  /**
   * Strip every service an earlier version published, leaving the thermostat
   * alone on the accessory.
   *
   * The OccupancySensors fed "Occupancy Detected" into the room for the length
   * of a cook and could fire unrelated occupancy automations. The separate
   * temperature sensors mattered for a different reason: with more than one
   * service on the accessory, Apple Home chose which tile to put in Home View
   * itself, and it kept choosing a sensor's flat grey tile over the lit
   * thermostat — a choice setPrimaryService did not override. One service means
   * there is nothing else for it to pick.
   */
  private removeRetiredServices(): void {
    for (const name of ['Cooking', 'Smoke Active', 'Grate Temperature', 'Probe Temperature']) {
      const retired = this.accessory!.getService(name)
      if (retired) {
        this.accessory!.removeService(retired)
        this.debugLog(`Removed retired service: ${name}`)
      }
    }
  }

  private heatingState(): CharacteristicValue {
    return this.cooking
      ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
      : this.platform.Characteristic.CurrentHeatingCoolingState.OFF
  }

  /**
   * A Thermostat has to expose writable characteristics, but this device does
   * not send commands. Put the appliance's real value straight back so the tile
   * snaps to the truth instead of holding whatever was dialled in.
   */
  private revertWrite(): void {
    void this.debugLog('Smoker is read-only; reverting the requested change')
    // Held so shutdown can cancel it - otherwise it publishes into an accessory
    // that is already being torn down
    this.revertTimer = setTimeout(() => this.publish(), 100)
  }

  /**
   * Resolve the v2 device, take one full reading, then let pushes drive it.
   * The appliance publishes about once a minute while cooking, so there is no
   * poll loop — refreshRate is not consulted for this device.
   */
  private async start(): Promise<void> {
    const applianceId = this.device.applianceId
    if (!applianceId) {
      await this.warnLog('Smoker has no applianceId; cannot resolve its v2 device')
      return
    }

    this.deviceId = await this.platform.v2.resolveDeviceId(applianceId)
    if (!this.deviceId) {
      await this.warnLog(`Smoker ${applianceId} was not found in the v2 device list; no live data will be available`)
      return
    }
    await this.debugLog(`Smoker v2 deviceId: ${this.deviceId}`)

    await this.refreshAll()

    await this.platform.v2.connect()
    this.unsubscribe = this.platform.v2.onServiceUpdate(this.deviceId, (message) => {
      this.applyService({
        serviceId: message.serviceId,
        serviceType: message.serviceType,
        domainType: message.domainType,
        serviceDeviceType: message.serviceDeviceType,
        state: message.state,
      })
      this.publish()
    })
  }

  /**
   * One full read of every service, used at startup so the accessory is
   * populated before the first push arrives.
   */
  private async refreshAll(): Promise<void> {
    if (!this.deviceId) {
      return
    }
    try {
      const services = await this.platform.v2.getServices(this.deviceId)
      for (const service of services) {
        this.applyService(service)
      }
      this.publish()
    } catch (error: any) {
      await this.warnLog(`Smoker could not read its v2 state: ${error?.message ?? error}`)
    }
  }

  /**
   * Fold one service — from a full read or a push — into the cached state.
   */
  private applyService(service: V2Service): void {
    const { serviceType, domainType, serviceDeviceType, state } = service

    // Only the probe's reading is kept. The chamber publishes an identically
    // shaped service — `serviceDeviceType` is the sole discriminator — and is
    // ignored on purpose: it disagrees with the temperature the SmartHQ app
    // shows, and it is not something an owner can act on.
    if (serviceType === SERVICE.TEMPERATURE && domainType === DOMAIN.MEASUREMENT) {
      const celsius = readCelsius(state)
      if (celsius !== undefined && serviceDeviceType === OWNER.PROBE) {
        this.probeTempC = celsius
      }
      return
    }

    if (serviceType === SERVICE.COOKING_MODE && domainType && state) {
      this.cookModes.set(domainType, state)
      this.recomputeSetpoint()
      return
    }

    if (serviceType === SERVICE.COOKING_STATE && domainType === DOMAIN.COOKING) {
      this.cooking = state?.runStatus === RUN_STATUS_ACTIVE
      this.activeMode = state?.mode
      this.recomputeSetpoint()
      return
    }

    if (serviceType === SERVICE.TOGGLE && domainType === DOMAIN.SMOKE) {
      this.smoking = state?.on === true
    }
  }

  private recomputeSetpoint(): void {
    const setpoint = cavitySetpointCelsius(this.activeMode, this.cookModes)
    if (setpoint !== undefined) {
      this.setpointC = setpoint
    }
  }

  /**
   * Push the cached state into HomeKit. Temperatures are only published when a
   * real reading has been seen, so an accessory never reports 0°C for a sensor
   * that has simply not reported yet.
   */
  private publish(): void {
    if (this.probeTempC !== undefined) {
      this.thermostatService?.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        clampToHomeKitCelsius(this.probeTempC),
      )
    }
    if (this.setpointC !== undefined) {
      this.thermostatService?.updateCharacteristic(
        this.platform.Characteristic.TargetTemperature,
        clampToHomeKitTarget(this.setpointC),
      )
    }
    this.thermostatService?.updateCharacteristic(
      this.platform.Characteristic.CurrentHeatingCoolingState,
      this.heatingState(),
    )
    this.thermostatService?.updateCharacteristic(
      this.platform.Characteristic.TargetHeatingCoolingState,
      this.heatingState(),
    )
    // Homebridge only rewrites its accessory cache on structural changes, so
    // the cache file is no guide to what HomeKit is actually being served.
    // Log what was published instead.
    void this.debugLog(
      `published probe=${this.asFahrenheit(this.probeTempC)} `
      + `setpoint=${this.asFahrenheit(this.setpointC)} cooking=${this.cooking} smoking=${this.smoking} `
      + `mode=${this.activeMode ?? 'none'}`,
    )
  }

  private asFahrenheit(celsius: number | undefined): string {
    return celsius === undefined ? 'unknown' : `${Math.round((celsius * 9) / 5 + 32)}F`
  }

  /**
   * Drop the push subscription and cancel any pending revert.
   *
   * ⚠️ Named `shutdown` deliberately: the platform's teardown calls
   * `control?.shutdown?.()` on every accessory, so anything else is silently
   * never called. The v2 websocket itself is shared, and the platform closes it.
   */
  public shutdown(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    clearTimeout(this.revertTimer)
    this.revertTimer = undefined
  }
}
