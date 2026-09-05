/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * cooktop.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { Buffer } from 'node:buffer'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

/**
 * One burner as the cooktop status reports it.
 *
 * The status is 13 bytes: an overall on/off byte, then six two-byte burner
 * slots of a flag byte and a power byte. Read off a five-burner Profile
 * induction cooktop (CHP95362M4SS) while each burner was used in turn (#125):
 * slot 1 was left front, 2 left rear, 3 unused on that model, 4 centre,
 * 5 right front, 6 right rear. The flag byte's idle value differs by slot
 * (0x23 on the front-left pair, 0x01 elsewhere) and gains 0x40 while the
 * burner is on; the power byte held values from 0x0A to 0x4B as the setting
 * was moved, and 0 when off.
 */
export interface CooktopBurner {
  slot: number
  on: boolean
  power: number
}

const BURNER_ON_FLAG = 0x40

/** Whether any part of the cooktop is on, from the status payload's first byte. */
export function cooktopIsOn(status: string | undefined): boolean {
  return !!status && status.length >= 2 && Number.parseInt(status.substring(0, 2), 16) !== 0
}

/** The per-burner breakdown of a status payload, for the debug log. */
export function cooktopBurners(status: string | undefined): CooktopBurner[] {
  if (!status || status.length < 26) {
    return []
  }
  const b = Buffer.from(status, 'hex')
  const burners: CooktopBurner[] = []
  for (let slot = 0; slot < 6; slot++) {
    const flags = b.readUint8(1 + slot * 2)
    burners.push({ slot: slot + 1, on: (flags & BURNER_ON_FLAG) !== 0, power: b.readUint8(2 + slot * 2) })
  }
  return burners
}

/**
 * A standalone cooktop, shown as a read-only "cooktop on" sensor.
 *
 * Ranges already expose their cooktop this way, and HomeKit has nothing that
 * fits a burner; what an owner can act on is whether the hob has been left on.
 * Nothing is written to the appliance - induction hobs will not start remotely
 * in any case.
 */
export class SmartHQCooktop extends deviceBase {
  private sensor!: Service

  constructor(
    protected readonly platform: SmartHQPlatform,
    protected readonly accessory: PlatformAccessory<SmartHqContext>,
    protected readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    this.debugLog(`Cooktop Features: ${JSON.stringify(accessory.context.device.features)}`)

    this.sensor = this.accessory.getService('Cooktop')
      ?? this.accessory.addService(this.platform.Service.ContactSensor, 'Cooktop', 'Cooktop')
    this.setServiceName(this.sensor, 'Cooktop')

    this.sensor
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        try {
          const status = await this.try_get_erd_value(ERD_TYPES.COOKTOP_STATUS)
          return this.stateFor(status)
        } catch (error: any) {
          this.warnLog?.(`Cooktop state error: ${error?.message ?? error}`)
          return this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
        }
      })
  }

  /** Open (not detected) = on, matching how ranges show their cooktop. */
  private stateFor(status: string | undefined): number {
    return cooktopIsOn(status)
      ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
  }

  /** Reflect a pushed status straight away, and record what the burners said. */
  onErdUpdate(erd: string, value: string): void {
    if (erd !== ERD_TYPES.COOKTOP_STATUS.toLowerCase()) {
      return
    }
    this.sensor.updateCharacteristic(this.platform.Characteristic.ContactSensorState, this.stateFor(value))
    const lit = cooktopBurners(value).filter(burner => burner.on)
    this.debugLog(`Cooktop ${cooktopIsOn(value) ? 'on' : 'off'}${lit.length ? ` - burners ${lit.map(burner => `${burner.slot}@${burner.power}`).join(', ')}` : ''}`)
  }
}
