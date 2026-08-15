/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * dishDrawer.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { deviceBase } from './device.js'

/**
 * A Fisher & Paykel DishDrawer is two independent dishwashers in one appliance,
 * and it does not speak the GE dishwasher's ERD dialect. Everything below is
 * read from an owner's debug log on a DDD196US (#120), correlated against a
 * written timeline of what they did and when.
 *
 * The appliance declares its two tubs in its own feature list:
 * `FPA_DISHDRAWER_V1_TUB_0` and `FPA_DISHDRAWER_V1_TUB_1`, each with its own
 * `_END_OF_CYCLE`. The ERD space follows that split - tub 1 sits `0x200` above
 * tub 0:
 *
 * | what              | tub 0 (bottom) | tub 1 (top) |
 * |-------------------|----------------|-------------|
 * | door              | `0x3037`       | `0x3237`    |
 * | cycle status      | `0x3007`       | `0x3207`    |
 * | cycle state       | `0x300e`       | `0x320e`    |
 * | time remaining    | `0xd004`       | `0xd204`    |
 *
 * Proven from the log: both door ERDs, the tub 0 cycle ERDs, and that tub 0 is
 * the BOTTOM drawer (the cycle they started in the bottom drawer moved the
 * un-offset addresses). The tub 1 cycle/time addresses are the offset applied
 * to the proven pattern and are still to be confirmed by running a cycle in
 * the top drawer - an unsupported ERD simply reads as undefined here, so if
 * the guess is wrong the top drawer reports "not running" rather than
 * misbehaving.
 */

/** Per-tub ERD offset: tub 1 sits 0x200 above tub 0. */
const TUB_ERD_OFFSET = 0x200

/** Tub 0 (bottom drawer) ERD addresses, offset per tub by TUB_ERD_OFFSET. */
const DISH_DRAWER_ERD_BASE = {
  door: 0x3037,
  cycleStatus: 0x3007,
  cycleState: 0x300E,
  timeRemaining: 0xD004,
} as const

/**
 * Door polarity, and it is the OPPOSITE of the GE dishwasher handler's.
 *
 * Six transitions across both drawers in the log, each within a second or two
 * of the owner's noted time: opening a drawer pushes `00`, closing it pushes
 * `01`. The GE handler reads `1` as open, which is why the drawer sat
 * permanently "Open" in the Home app - it read `01` (closed) at startup.
 * There is no evidence either way about real GE dishwashers, so that handler
 * is deliberately left alone.
 */
const DOOR_OPEN = 0x00

/**
 * Byte 1 of the cycle-status ERD. Only two values have ever been observed:
 * `00 04 0C` when a cycle was started and `00 08 0C` when it was paused, so
 * byte 1 carries the run state (byte 2 looks like the selected cycle - `0C`
 * was ECO). Anything else is treated as not running, which is the safe
 * default, and logged once so a future report can name it.
 */
const CYCLE_STATUS_RUNNING = 0x04
const CYCLE_STATUS_PAUSED = 0x08

/** Which tubs exist, and what to call them. Index is the tub number. */
export const DISH_DRAWER_TUBS = [
  { index: 0, label: 'Bottom Drawer' },
  { index: 1, label: 'Top Drawer' },
] as const

export type DishDrawerErdField = keyof typeof DISH_DRAWER_ERD_BASE

/** The ERD address for a field on a tub, lowercase to match pushed codes. */
export function dishDrawerErd(tub: number, field: DishDrawerErdField): string {
  return `0x${(DISH_DRAWER_ERD_BASE[field] + (tub * TUB_ERD_OFFSET)).toString(16)}`
}

/** The tub and field a pushed ERD belongs to, or undefined if it is not ours. */
export function dishDrawerTubForErd(erd: string): { tub: number, field: DishDrawerErdField } | undefined {
  const wanted = erd.toLowerCase()
  for (const { index } of DISH_DRAWER_TUBS) {
    for (const field of Object.keys(DISH_DRAWER_ERD_BASE) as DishDrawerErdField[]) {
      if (dishDrawerErd(index, field) === wanted) {
        return { tub: index, field }
      }
    }
  }
  return undefined
}

/**
 * Whether a door ERD value means the drawer is open. An unreadable value is
 * reported as closed by the caller - a drawer wrongly showing "open" is the
 * more alarming failure.
 */
export function isDishDrawerDoorOpen(raw: string | undefined): boolean {
  return raw !== undefined && Number.parseInt(raw, 16) === DOOR_OPEN
}

/** Byte 1 of a cycle-status value, or undefined if it cannot be read. */
export function dishDrawerCycleStatusByte(raw: string | undefined): number | undefined {
  if (!raw || raw.length < 4) {
    return undefined
  }
  const byte = Number.parseInt(raw.slice(2, 4), 16)
  return Number.isNaN(byte) ? undefined : byte
}

/** Whether a cycle-status byte is one the appliance has been observed sending. */
export function isKnownDishDrawerCycleStatus(byte: number | undefined): boolean {
  return byte === CYCLE_STATUS_RUNNING || byte === CYCLE_STATUS_PAUSED
}

/**
 * Remaining cycle time in seconds, clamped to HomeKit's maximum. The raw value
 * is minutes: the owner's log shows `0x78` (120) falling to `0x77` (119)
 * exactly 59 seconds later, which settles a units question the dishwasher
 * handler had only assumed.
 */
export function dishDrawerRemainingSeconds(raw: string | undefined): number {
  if (!raw) {
    return 0
  }
  const minutes = Number.parseInt(raw, 16)
  if (Number.isNaN(minutes) || minutes <= 0) {
    return 0
  }
  return Math.min(minutes * 60, 86400)
}

interface TubServices {
  valve: Service
  doorSensor: Service
}

export class SmartHQDishDrawer extends deviceBase {
  // HAP services per tub, kept for live websocket updates
  private tubServices = new Map<number, TubServices>()

  // Cycle-status byte 1 values already reported as unrecognised, so a repeating
  // push does not repeat the log line
  private reportedUnknownStatuses = new Set<number>()

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.debugLog(`DishDrawer Features: ${JSON.stringify(accessory.context.device.features)}`)
    this.initializeHAP()
  }

  private initializeHAP(): void {
    for (const { index, label } of DISH_DRAWER_TUBS) {
      // Running state. Read-only: the SmartHQ api cannot start a drawer.
      const valve = this.accessory!.getService(label) ?? this.accessory!.addService(this.platform.Service.Valve, label, `DishDrawerTub${index}`)
      this.setServiceName(valve, label)
      valve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)

      valve
        .getCharacteristic(this.platform.Characteristic.Active)
        .onGet(async () => await this.isCycleEngaged(index)
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE)
        .onSet(async () => {
          this.infoLog(`The ${label} tile is a read-only display; starting or stopping a cycle from HomeKit is not supported`)
          valve.updateCharacteristic(
            this.platform.Characteristic.Active,
            await this.isCycleEngaged(index)
              ? this.platform.Characteristic.Active.ACTIVE
              : this.platform.Characteristic.Active.INACTIVE,
          )
        })

      valve
        .getCharacteristic(this.platform.Characteristic.InUse)
        .onGet(async () => await this.isCycleRunning(index)
          ? this.platform.Characteristic.InUse.IN_USE
          : this.platform.Characteristic.InUse.NOT_IN_USE)

      valve
        .getCharacteristic(this.platform.Characteristic.RemainingDuration)
        // The default maximum is 3600s; a two hour cycle is 7200, which HomeKit
        // rejects as an illegal value and clamps to 60 minutes
        .setProps({ maxValue: 86400 })
        .onGet(async () => this.getRemainingSeconds(index))

      // Door
      const doorLabel = `${label} Door`
      const doorSensor = this.accessory!.getService(doorLabel) ?? this.accessory!.addService(this.platform.Service.ContactSensor, doorLabel, `DishDrawerTub${index}Door`)
      this.setServiceName(doorSensor, doorLabel)
      doorSensor
        .getCharacteristic(this.platform.Characteristic.ContactSensorState)
        .onGet(async () => this.doorState(await this.try_get_erd_value(dishDrawerErd(index, 'door'))))

      this.tubServices.set(index, { valve, doorSensor })
    }
  }

  /**
   * Map a door ERD value to a contact state. An unreadable value is reported as
   * closed (contact detected), matching how the other devices treat a missing
   * reading - a drawer wrongly showing "open" is the more alarming failure.
   */
  private doorState(raw: string | undefined): number {
    return isDishDrawerDoorOpen(raw)
      ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
  }

  /** Byte 1 of the cycle-status ERD for a tub, or undefined if unreadable. */
  private async cycleStatusByte(tub: number): Promise<number | undefined> {
    const erd = dishDrawerErd(tub, 'cycleStatus')
    const raw = await this.try_get_erd_value(erd)
    const byte = dishDrawerCycleStatusByte(raw)
    if (byte !== undefined && !isKnownDishDrawerCycleStatus(byte) && !this.reportedUnknownStatuses.has(byte)) {
      this.reportedUnknownStatuses.add(byte)
      this.infoLog(`unrecognised dish drawer cycle status - please include this line if you report it: ${JSON.stringify({ tub, erd, raw })}`)
    }
    return byte
  }

  /** A cycle is engaged when it is running or paused. */
  private async isCycleEngaged(tub: number): Promise<boolean> {
    const byte = await this.cycleStatusByte(tub)
    return byte === CYCLE_STATUS_RUNNING || byte === CYCLE_STATUS_PAUSED
  }

  /** A cycle is actively running (not paused). */
  private async isCycleRunning(tub: number): Promise<boolean> {
    return await this.cycleStatusByte(tub) === CYCLE_STATUS_RUNNING
  }

  /** Remaining cycle time in seconds for a tub. */
  private async getRemainingSeconds(tub: number): Promise<number> {
    return dishDrawerRemainingSeconds(await this.try_get_erd_value(dishDrawerErd(tub, 'timeRemaining')))
  }

  /**
   * Reflect a pushed ERD in HomeKit straight away.
   *
   * The door value arrives with the push, so it is used directly rather than
   * read back - the appliance 400s a polled read of some of these ERDs even
   * though it pushes them happily (`0xd004` does exactly that), so a read-back
   * would throw away a value we already have.
   */
  onErdUpdate(erd: string, value: string): void {
    const match = dishDrawerTubForErd(erd)
    if (!match) {
      return
    }
    const services = this.tubServices.get(match.tub)
    if (!services) {
      return
    }

    if (match.field === 'door') {
      services.doorSensor.updateCharacteristic(this.platform.Characteristic.ContactSensorState, this.doorState(value))
      return
    }

    void this.applyLiveCycleUpdate(match.tub, services).catch((error: any) => {
      this.debugLog(`Live dish drawer update for ${erd} failed: ${error?.message ?? error}`)
    })
  }

  private async applyLiveCycleUpdate(tub: number, services: TubServices): Promise<void> {
    services.valve.updateCharacteristic(
      this.platform.Characteristic.Active,
      await this.isCycleEngaged(tub)
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE,
    )
    services.valve.updateCharacteristic(
      this.platform.Characteristic.InUse,
      await this.isCycleRunning(tub)
        ? this.platform.Characteristic.InUse.IN_USE
        : this.platform.Characteristic.InUse.NOT_IN_USE,
    )
    services.valve.updateCharacteristic(
      this.platform.Characteristic.RemainingDuration,
      await this.getRemainingSeconds(tub),
    )
  }
}
