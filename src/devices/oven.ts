/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * oven.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { Buffer } from 'node:buffer'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

/**
 * Whether an oven really has a second (lower) cavity.
 *
 * ⚠️ The presence of a lower-cavity ERD is NOT proof of a lower cavity. A
 * single oven can answer one with a placeholder rather than not answering at
 * all: the unit in #109 returns `CC` for LOWER_OVEN_CURRENT_STATE while having
 * no second cavity. Reading that as "double oven" gave it four lower-oven tiles
 * that could never work, and 0xCC also parses as 204, so the lower oven looked
 * like it was cooking permanently.
 *
 * The temperature is the reliable signal — a real cavity reports one. The GE
 * Cafe double oven in #46 answers LOWER_OVEN_RAW_TEMPERATURE; the single oven
 * in #109 does not answer it at all.
 */
export function hasLowerOvenCavity(lowerRawTemperature: string | undefined): boolean {
  return lowerRawTemperature !== undefined
}

export class SmartHQOven extends deviceBase {
  // Matter support override flag
  private useMatterOverride: boolean = false

  // HAP services kept for live websocket updates (#8)
  private ovenLight?: Service
  private ovenThermostat?: Service
  private probeTempSensor?: Service
  private cookTimeValve?: Service
  private cooktopSensor?: Service
  private probeRemovalLogged: boolean = false
  /** Last known bake target in Fahrenheit, used when starting a bake from HomeKit */
  private lastTargetTempF = 350

  // Lower cavity services, only created on double ovens (#46). Kept separate
  // from the upper set rather than sharing one parameterised path: the upper
  // cavity carries extra behaviour (cook control, cooktop, remote-enabled)
  // and has had a lot of model-specific fixing, so the lower cavity is added
  // alongside it rather than by reworking a path that already works.
  //
  // These are read-only on purpose. The lower cavity's reporting is confirmed
  // against a real double oven, but its cook-mode writes are not, and starting
  // an oven is not something to ship on an untested guess.
  private lowerOvenLight?: Service
  private lowerOvenTempSensor?: Service
  private lowerProbeTempSensor?: Service
  private lowerCookTimeValve?: Service
  private lowerProbeRemovalLogged: boolean = false

  constructor(
    readonly platform: SmartHQPlatform,
    accessory: PlatformAccessory<SmartHqContext>,
    readonly device: SmartHqContext['device'] & devicesConfig,
  ) {
    super(platform, accessory, device)

    // Check if we should use Matter protocol
    this.useMatterOverride = device.useMatter ?? false

    this.debugLog(`Oven Features: ${JSON.stringify(accessory.context.device.features)}`)
    this.debugLog(`Using protocol: ${this.useMatterOverride ? 'Matter' : 'HAP'}`)

    // Initialize the appropriate protocol
    if (this.useMatterOverride) {
      this.initializeMatter().catch((error) => {
        this.errorLog(`Failed to initialize Matter: ${error}`)
      })
    } else {
      this.initializeHAP()
    }
  }

  /**
   * Initialize Matter protocol
   */
  private async initializeMatter(): Promise<void> {
    const { valid, api: matterAPI } = this.validateMatterAPI()

    if (!valid) {
      if (this.device.matterOnly) {
        this.errorLog('Matter API not available or incomplete - accessory will NOT be published (matterOnly mode enabled)')
        this.errorLog('Reason: Matter API validation failed')
        return
      }
      this.errorLog('Matter API not available or incomplete - falling back to HAP')
      this.initializeHAP()
      return
    }

    // Check if OvenDevice device type is available
    if (!matterAPI.deviceTypes.OvenDevice) {
      // ⚠️ Deliberately NOT honouring matterOnly here. Homebridge has no
      // OvenDevice device type at all, so this is not a "Matter is
      // temporarily unavailable" case that might resolve on a restart - it can
      // never be satisfied. Refusing to publish would mean the appliance simply
      // never appears, with only a log line to explain why. Fall back to HAP and
      // say so loudly instead (#111).
      if (this.device.matterOnly) {
        this.warnLog('Ignoring matterOnly: Homebridge has no OvenDevice device type, so Matter can never be used for this appliance. Publishing over HAP instead.')
        this.warnLog('The Matter options have been hidden in the plugin settings for this reason; you can safely remove matterOnly from your config.')
      }
      this.warnLog('Matter OvenDevice device type not available in this Homebridge version - falling back to HAP')
      this.warnLog(`Available Matter device types: ${Object.keys(matterAPI.deviceTypes).join(', ')}`)
      this.useMatterOverride = false
      this.initializeHAP()
      return
    }

    const serialNumber = this.device.applianceId || 'unknown'
    this.matterUuid = matterAPI.uuid.generate(serialNumber)

    // Create Matter accessory configuration with oven-specific clusters
    const matterAccessory = {
      UUID: this.matterUuid,
      displayName: this.device.nickname || 'SmartHQ Oven',
      serialNumber,
      manufacturer: this.device.brand && this.device.brand !== 'Unknown' ? this.device.brand : 'GE Appliances',
      model: this.device.model || 'SmartHQ',
      firmwareRevision: this.deviceFirmwareVersion,
      hardwareRevision: this.deviceFirmwareVersion,
      deviceType: matterAPI.deviceTypes.OvenDevice,
      clusters: {
        // On/Off cluster for oven light
        onOff: {
          onOff: false,
        },
        // Temperature Measurement for oven cavity (maps to UPPER_OVEN_DISPLAY_TEMPERATURE)
        temperatureMeasurement: {
          measuredValue: 2000, // 20°C in 0.01°C units
          minMeasuredValue: 0,
          maxMeasuredValue: 26000, // 260°C max
        },
        // Thermostat cluster for temperature setpoint control
        thermostat: {
          localTemperature: 2000,
          occupiedHeatingSetpoint: 17500, // 175°C default
          systemMode: 0, // 0=Off, 4=Heat
          thermostatRunningMode: 0,
          controlSequenceOfOperation: 2, // Heating only
        },
        // Oven Mode cluster for cooking modes (maps to UPPER_OVEN_COOK_MODE)
        ovenMode: {
          supportedModes: [
            { label: 'Off', mode: 0 },
            { label: 'Bake', mode: 1 },
            { label: 'Convection Bake', mode: 2 },
            { label: 'Broil High', mode: 3 },
            { label: 'Broil Low', mode: 4 },
            { label: 'Convection Multi', mode: 5 },
          ],
          currentMode: 0,
        },
        // Timer cluster for cook time remaining (maps to UPPER_OVEN_COOK_TIME_REMAINING)
        timer: {
          timerState: 0,
          duration: 0,
          remainingTime: 0,
        },
        // Alarm cluster for preheat complete, cooking done
        alarm: {
          mask: 0,
          state: 0,
          supported: 3, // Bits: 0=preheat complete, 1=cook complete
        },
        // Door Lock cluster for oven door
        doorLock: {
          lockState: 0, // 0=Unlocked, 1=Locked
          lockType: 0,
          actuatorEnabled: true,
        },
      },
      handlers: {
        onOff: {
          on: async () => {
            await this.writeErd(ERD_TYPES.UPPER_OVEN_LIGHT, true)
          },
          off: async () => {
            await this.writeErd(ERD_TYPES.UPPER_OVEN_LIGHT, false)
          },
        },
      },
    }

    // Register Matter accessory as external device
    await matterAPI.registerPlatformAccessories(
      '@homebridge-plugins/homebridge-smarthq',
      'SmartHQ',
      [matterAccessory],
    )
    this.matterRegistered = true
    this.infoLog('Created Matter Oven with thermostat, mode selection, timer, alarm, and door lock clusters')
  }

  /**
   * Initialize HAP (HomeKit) protocol
   */
  private initializeHAP(): void {
    // Log the raw light availability and remote enable values once at startup —
    // many GE ovens accept the light write over the cloud but the appliance
    // ignores it when remote light control is not supported (#8)
    ;(async () => {
      const lightAvailability = await this.readErd(ERD_TYPES.UPPER_OVEN_LIGHT_AVAILABILITY)
      const remoteEnabled = await this.readErd(ERD_TYPES.UPPER_OVEN_REMOTE_ENABLED)
      this.debugLog(`Oven light availability raw: ${lightAvailability ?? 'not reported'}, remote enabled raw: ${remoteEnabled ?? 'not reported'}`)
    })()

    // Oven Light: only shown when the oven reports its light over the api —
    // some ranges (e.g. the JS760SP6SS) have no remote light control at all,
    // the GE app hides it too, and a tile here could never work (#8)
    ;(async () => {
      const lightSupported = await this.has_erd_code(ERD_TYPES.UPPER_OVEN_LIGHT)
      if (!lightSupported) {
        const staleLight = this.accessory!.getService('Oven Light')
        if (staleLight) {
          this.accessory!.removeService(staleLight)
          this.infoLog('This oven does not report its light over the SmartHQ api, so the Oven Light tile has been removed')
        }
        return
      }
      const ovenLight = this.accessory!.getService('Oven Light') ?? this.accessory!.addService(this.platform.Service.Lightbulb, 'Oven Light', 'OvenLight')
      this.ovenLight = ovenLight
      this.setServiceName(ovenLight, 'Oven Light')
      ovenLight
        .getCharacteristic(this.platform.Characteristic.On)
        .onGet(async () => {
          try {
            const r = await this.readErd(ERD_TYPES.UPPER_OVEN_LIGHT)
            return r ? Number.parseInt(r) !== 0 : false
          } catch (error: any) {
            this.warnLog?.(`Oven Light handleGetOn error: ${error?.message ?? error}`)
            return false
          }
        })
        .onSet(async (value) => {
          try {
            await this.writeErd(ERD_TYPES.UPPER_OVEN_LIGHT, value as boolean)
          } catch (error: any) {
            this.warnLog?.(`Oven Light handleSetOn error: ${error?.message ?? error}`)
          }
        })
    })()

    // Oven Thermostat: shows the ACTUAL cavity temperature and adds remote
    // control - setting HEAT starts a bake at the target temperature (the
    // same write the official app performs), OFF turns the oven off (#8).
    // It replaces the read-only temperature sensor from earlier versions.
    const staleTempSensor = this.accessory!.getService('Oven Temperature')
    if (staleTempSensor) {
      this.accessory!.removeService(staleTempSensor)
    }
    const ovenThermostat = this.accessory!.getService('Oven') ?? this.accessory!.addService(this.platform.Service.Thermostat, 'Oven', 'OvenThermostat')
    this.ovenThermostat = ovenThermostat
    this.setServiceName(ovenThermostat, 'Oven')
    ovenThermostat
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({ minValue: -20, maxValue: 500, minStep: 0.1 })
      .onGet(async () => {
        try {
          return await this.getCavityTempC()
        } catch (error: any) {
          this.warnLog?.(`Oven Temperature error: ${error?.message ?? error}`)
          return 0
        }
      })
    ovenThermostat
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({ minValue: 76.5, maxValue: 288, minStep: 0.5 })
      .onGet(async () => {
        const cookMode = await this.readCookMode()
        if (cookMode && cookMode.mode !== 0 && cookMode.tempF > 0) {
          this.lastTargetTempF = cookMode.tempF
        }
        return fToC(this.lastTargetTempF)
      })
      .onSet(async (value: CharacteristicValue) => {
        // GE ovens take Fahrenheit targets in 5 degree steps
        const tempF = Math.round(cToF(value as number) / 5) * 5
        this.lastTargetTempF = tempF
        const cookMode = await this.readCookMode()
        if (cookMode && cookMode.mode !== 0) {
          // Oven is already cooking - adjust the temperature within the
          // current mode
          await this.writeCookMode(cookMode.mode, tempF)
        }
        // When the oven is off the new target simply waits for HEAT to be set
      })
    ovenThermostat
      .getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .setProps({ validValues: [0, 1] })
      .onGet(async () => {
        return await this.isOvenRunning()
          ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
          : this.platform.Characteristic.CurrentHeatingCoolingState.OFF
      })
    ovenThermostat
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: [0, 1] })
      .onGet(async () => {
        const cookMode = await this.readCookMode()
        return cookMode && cookMode.mode !== 0
          ? this.platform.Characteristic.TargetHeatingCoolingState.HEAT
          : this.platform.Characteristic.TargetHeatingCoolingState.OFF
      })
      .onSet(async (value: CharacteristicValue) => {
        if (value === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
          // Start a plain bake at the target temperature (mode 1 =
          // BAKE_NOOPTION, the same as the appliance reports for a bake
          // started at the oven itself)
          this.infoLog(`Starting bake at ${this.lastTargetTempF}F from HomeKit`)
          await this.writeCookMode(1, this.lastTargetTempF)
        } else {
          this.infoLog('Turning the oven off from HomeKit')
          await this.writeCookMode(0, 0)
        }
      })
    ovenThermostat
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(async () => this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT)

    // Probe Temperature Sensor: only when a probe is actually plugged in —
    // checking mere ERD support left a permanent 0° sensor on probe-capable
    // ovens with no probe fitted (#8)
    ;(async () => {
      await this.syncProbeSensor()
    })()

    // Cooktop on/off sensor: read-only status for ranges that report their
    // cooktop over the api (#8). Some models reject the direct read but push
    // the status over the websocket, so the tile may first appear once the
    // cooktop is used after startup.
    ;(async () => {
      await this.syncCooktopSensor()
    })()

    // Cook Time valve: on/off now reflects whether the oven is actually
    // cooking (UPPER_OVEN_CURRENT_STATE) — it used to key off the cook TIMER,
    // so an untimed bake showed as "off" the whole time (#8). The remaining
    // duration still comes from the timer when one is set.
    const cookTimeValve = this.accessory!.getService('Cook Time') ?? this.accessory!.addService(this.platform.Service.Valve, 'Cook Time', 'CookTime')
    this.cookTimeValve = cookTimeValve
    this.setServiceName(cookTimeValve, 'Cook Time')
    cookTimeValve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)
    cookTimeValve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        return await this.isOvenRunning()
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE
      })
      .onSet(async () => {
        // The tile is a read-only display — revert the toggle to the real
        // state so a tap doesn't silently pretend to work
        this.infoLog('Cook Time is a read-only display; starting or stopping cooking from HomeKit is not yet supported')
        cookTimeValve.updateCharacteristic(
          this.platform.Characteristic.Active,
          await this.isOvenRunning()
            ? this.platform.Characteristic.Active.ACTIVE
            : this.platform.Characteristic.Active.INACTIVE,
        )
      })

    cookTimeValve
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        return await this.isOvenRunning()
          ? this.platform.Characteristic.InUse.IN_USE
          : this.platform.Characteristic.InUse.NOT_IN_USE
      })

    cookTimeValve
      .getCharacteristic(this.platform.Characteristic.RemainingDuration)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.UPPER_OVEN_COOK_TIME_REMAINING)
        if (!r) {
          return 0
        }
        // Cook time remaining is stored as minutes in hex, convert to seconds
        const minutes = Number.parseInt(r, 16)
        const seconds = minutes * 60
        this.debugLog(`Cook Time Remaining - Hex: ${r}, Minutes: ${minutes}, Seconds: ${seconds}`)
        return seconds
      })

    // Remote Enabled Status (binary sensor): only shown when the oven reports
    // this value — on models that don't, the tile sat on "closed" forever and
    // read as "remote disabled" when nothing of the sort was known (#8)
    ;(async () => {
      const remoteEnabledSupported = await this.has_erd_code(ERD_TYPES.UPPER_OVEN_REMOTE_ENABLED)
      if (!remoteEnabledSupported) {
        const staleRemoteEnabled = this.accessory!.getService('Remote Enabled')
        if (staleRemoteEnabled) {
          this.accessory!.removeService(staleRemoteEnabled)
          this.infoLog('This oven does not report its remote enable state over the SmartHQ api, so the Remote Enabled tile has been removed')
        }
        return
      }
      const remoteEnabledSensor = this.accessory!.getService('Remote Enabled') ?? this.accessory!.addService(this.platform.Service.ContactSensor, 'Remote Enabled', 'RemoteEnabled')
      this.setServiceName(remoteEnabledSensor, 'Remote Enabled')
      remoteEnabledSensor
        .getCharacteristic(this.platform.Characteristic.ContactSensorState)
        .onGet(async () => {
          const r = await this.readErd(ERD_TYPES.UPPER_OVEN_REMOTE_ENABLED)
          // 1=enabled (open/not detected), 0=disabled (closed/detected)
          return r && Number.parseInt(r) === 1
            ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
        })
    })()

    // Oven Door Lock: removed until a real door lock ERD is implemented — the
    // previous service was a stub whose lock control did nothing (#8)
    const staleDoorLock = this.accessory!.getService('Oven Door Lock')
    if (staleDoorLock) {
      this.accessory!.removeService(staleDoorLock)
    }

    // Lower cavity, for double ovens (#46)
    ;(async () => {
      await this.initializeLowerCavity()
    })()
  }

  /**
   * Add the lower cavity's services on double ovens. Everything is gated on
   * the oven actually reporting a lower cavity, so single ovens are left
   * exactly as they were rather than gaining tiles that could never work.
   *
   * Confirmed against a GE Cafe double oven (#46), which reports the lower
   * light (0x5211), temperature (0x520D), probe (0x5203) and elapsed cook
   * time (0x5208). That oven reports no door state at all, so there is
   * deliberately no door sensor here.
   *
   * ⚠️ The presence of a lower-cavity ERD is NOT proof of a lower cavity.
   * A single oven can answer one with a placeholder instead of not answering
   * at all: the unit in #109 returns 0xCC for LOWER_OVEN_CURRENT_STATE while
   * having no second cavity, which is enough for has_erd_code() to say yes.
   * That also made isLowerOvenRunning() read 0xCC as 204, so the lower oven
   * appeared to be cooking permanently and the log filled with the read-only
   * Cook Time notice.
   *
   * The temperature is the reliable signal — a real cavity reports one. The
   * #46 double oven answers LOWER_OVEN_RAW_TEMPERATURE; the #109 single oven
   * does not answer it at all. So gate on that alone, and do not trust the
   * current state on its own.
   */
  private async initializeLowerCavity(): Promise<void> {
    const lowerRawTemperature = await this.try_get_erd_value(ERD_TYPES.LOWER_OVEN_RAW_TEMPERATURE)
    const isDoubleOven = hasLowerOvenCavity(lowerRawTemperature)

    // The appliance's own description of its cavities would be a better gate
    // than probing individual ERDs, but its encoding is not yet known. Log it
    // in debug mode so real units can tell us what it looks like.
    const ovenConfiguration = await this.try_get_erd_value(ERD_TYPES.OVEN_CONFIGURATION)
    this.debugLog(`Oven configuration ERD ${ERD_TYPES.OVEN_CONFIGURATION}: ${ovenConfiguration ?? 'not reported'}`)

    if (!isDoubleOven) {
      // Drop any lower-cavity tiles left behind by a cached accessory
      ;['Lower Oven Light', 'Lower Oven Temperature', 'Lower Probe Temperature', 'Lower Cook Time'].forEach((name) => {
        const stale = this.accessory!.getService(name)
        if (stale) {
          this.accessory!.removeService(stale)
        }
      })
      return
    }

    this.debugLog('This oven reports a lower cavity, so the lower oven tiles have been added')

    // Lower Oven Light — same on/off shape as the upper light
    if (await this.has_erd_code(ERD_TYPES.LOWER_OVEN_LIGHT)) {
      const lowerOvenLight = this.accessory!.getService('Lower Oven Light')
        ?? this.accessory!.addService(this.platform.Service.Lightbulb, 'Lower Oven Light', 'LowerOvenLight')
      this.lowerOvenLight = lowerOvenLight
      this.setServiceName(lowerOvenLight, 'Lower Oven Light')
      lowerOvenLight
        .getCharacteristic(this.platform.Characteristic.On)
        .onGet(async () => {
          try {
            const r = await this.readErd(ERD_TYPES.LOWER_OVEN_LIGHT)
            return r ? Number.parseInt(r) !== 0 : false
          } catch (error: any) {
            this.warnLog?.(`Lower Oven Light handleGetOn error: ${error?.message ?? error}`)
            return false
          }
        })
        .onSet(async (value) => {
          try {
            await this.writeErd(ERD_TYPES.LOWER_OVEN_LIGHT, value as boolean)
          } catch (error: any) {
            this.warnLog?.(`Lower Oven Light handleSetOn error: ${error?.message ?? error}`)
          }
        })
    }

    // Lower Oven Temperature — a read-only sensor rather than a thermostat,
    // since cook control is not confirmed for the lower cavity
    const lowerOvenTempSensor = this.accessory!.getService('Lower Oven Temperature')
      ?? this.accessory!.addService(this.platform.Service.TemperatureSensor, 'Lower Oven Temperature', 'LowerOvenTemp')
    this.lowerOvenTempSensor = lowerOvenTempSensor
    this.setServiceName(lowerOvenTempSensor, 'Lower Oven Temperature')
    lowerOvenTempSensor
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({ minValue: -20, maxValue: 500, minStep: 0.1 })
      .onGet(async () => {
        try {
          return await this.getLowerCavityTempC()
        } catch (error: any) {
          this.warnLog?.(`Lower Oven Temperature error: ${error?.message ?? error}`)
          return 0
        }
      })

    // Lower Probe Temperature — only while a probe is actually fitted
    await this.syncLowerProbeSensor()

    // Lower Cook Time — read-only, mirroring the upper cavity's valve
    const lowerCookTimeValve = this.accessory!.getService('Lower Cook Time')
      ?? this.accessory!.addService(this.platform.Service.Valve, 'Lower Cook Time', 'LowerCookTime')
    this.lowerCookTimeValve = lowerCookTimeValve
    this.setServiceName(lowerCookTimeValve, 'Lower Cook Time')
    lowerCookTimeValve.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE)
    lowerCookTimeValve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        return await this.isLowerOvenRunning()
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE
      })
      .onSet(async () => {
        this.infoLog('Lower Cook Time is a read-only display; starting or stopping the lower oven from HomeKit is not supported')
        lowerCookTimeValve.updateCharacteristic(
          this.platform.Characteristic.Active,
          await this.isLowerOvenRunning()
            ? this.platform.Characteristic.Active.ACTIVE
            : this.platform.Characteristic.Active.INACTIVE,
        )
      })

    lowerCookTimeValve
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(async () => {
        return await this.isLowerOvenRunning()
          ? this.platform.Characteristic.InUse.IN_USE
          : this.platform.Characteristic.InUse.NOT_IN_USE
      })

    lowerCookTimeValve
      .getCharacteristic(this.platform.Characteristic.RemainingDuration)
      .onGet(async () => {
        const r = await this.readErd(ERD_TYPES.LOWER_OVEN_COOK_TIME_REMAINING)
        if (!r) {
          return 0
        }
        const minutes = Number.parseInt(r, 16)
        this.debugLog(`Lower Cook Time Remaining - Hex: ${r}, Minutes: ${minutes}`)
        return minutes * 60
      })
  }

  /**
   * The lower cavity's actual temperature in °C, using the same raw-then-display
   * preference as the upper cavity. Both arrive as hex-encoded °F.
   */
  private async getLowerCavityTempC(): Promise<number> {
    const hex = await this.try_get_erd_value(ERD_TYPES.LOWER_OVEN_RAW_TEMPERATURE)
      ?? await this.try_get_erd_value(ERD_TYPES.LOWER_OVEN_DISPLAY_TEMPERATURE)
    if (!hex) {
      return 0
    }
    return fToC(Number.parseInt(hex, 16))
  }

  /**
   * Whether the lower cavity is currently cooking (any non-zero state).
   */
  private async isLowerOvenRunning(): Promise<boolean> {
    const r = await this.try_get_erd_value(ERD_TYPES.LOWER_OVEN_CURRENT_STATE)
    return !!r && Number.parseInt(r, 16) !== 0
  }

  /**
   * Whether a probe is plugged into the lower cavity. Ovens that report a
   * probe temperature without a probe-present flag are treated as fitted, so
   * a working probe is not hidden by a missing flag (#46).
   */
  private async isLowerProbeFitted(): Promise<boolean> {
    const present = await this.try_get_erd_value(ERD_TYPES.LOWER_OVEN_PROBE_PRESENT)
    if (present !== undefined) {
      return Number.parseInt(present, 16) === 1
    }
    const temp = await this.try_get_erd_value(ERD_TYPES.LOWER_OVEN_PROBE_DISPLAY_TEMP)
    return temp !== undefined && Number.parseInt(temp, 16) > 0
  }

  /**
   * Add the lower cavity's probe sensor while a probe is fitted, remove it
   * when not. Safe to call repeatedly, so plugging a probe in shows the tile
   * without a restart.
   */
  private async syncLowerProbeSensor(): Promise<void> {
    if (await this.isLowerProbeFitted()) {
      const lowerProbeTempSensor = this.accessory!.getService('Lower Probe Temperature')
        ?? this.accessory!.addService(this.platform.Service.TemperatureSensor, 'Lower Probe Temperature', 'LowerProbeTemp')
      this.lowerProbeTempSensor = lowerProbeTempSensor
      this.lowerProbeRemovalLogged = false
      this.setServiceName(lowerProbeTempSensor, 'Lower Probe Temperature')
      lowerProbeTempSensor
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .setProps({ minValue: -20, maxValue: 500, minStep: 0.1 })
        .onGet(async () => {
          const r = await this.try_get_erd_value(ERD_TYPES.LOWER_OVEN_PROBE_DISPLAY_TEMP)
          if (!r) {
            return 0
          }
          return fToC(Number.parseInt(r, 16))
        })
      return
    }
    const staleProbe = this.accessory!.getService('Lower Probe Temperature')
    if (staleProbe) {
      this.accessory!.removeService(staleProbe)
    }
    this.lowerProbeTempSensor = undefined
    if (!this.lowerProbeRemovalLogged) {
      this.lowerProbeRemovalLogged = true
      this.infoLog('No temperature probe is plugged into the lower oven, so the Lower Probe Temperature tile is not shown (it appears when a probe is fitted)')
    }
  }

  /**
   * The actual cavity temperature in °C. The raw thermistor reading updates
   * far more often over the websocket than the display temperature, so it is
   * preferred; both arrive as hex-encoded °F.
   */
  private async getCavityTempC(): Promise<number> {
    const hex = await this.try_get_erd_value(ERD_TYPES.UPPER_OVEN_RAW_TEMPERATURE)
      ?? await this.try_get_erd_value(ERD_TYPES.UPPER_OVEN_DISPLAY_TEMPERATURE)
    if (!hex) {
      return 0
    }
    return fToC(Number.parseInt(hex, 16))
  }

  /**
   * The current cook mode setting: mode byte plus target temperature in
   * Fahrenheit. The 13-byte payload layout (mode 1B, temp 2B, cook time,
   * probe temp, delay and two-temp fields) matches the gehome project's
   * OvenCookModeConverter and was confirmed byte-for-byte on a real JS760
   * (bake at 350F reports 01015E00000000000000000000).
   */
  private async readCookMode(): Promise<{ mode: number, tempF: number } | undefined> {
    const r = await this.try_get_erd_value(ERD_TYPES.UPPER_OVEN_COOK_MODE)
    if (!r || r.length < 6) {
      return undefined
    }
    const b = Buffer.from(r, 'hex')
    return { mode: b.readUint8(0), tempF: b.readUint16BE(1) }
  }

  /**
   * Write a cook mode: mode 1 with a temperature starts a bake, mode 0
   * turns the oven off. Remaining payload fields (times, probe, delay)
   * are zero - a plain immediate bake, exactly like pressing Bake+Start.
   */
  private async writeCookMode(mode: number, tempF: number): Promise<void> {
    const payload = mode.toString(16).padStart(2, '0')
      + tempF.toString(16).padStart(4, '0')
      + '0'.repeat(20)
    await this.writeErd(ERD_TYPES.UPPER_OVEN_COOK_MODE, payload)
  }

  /**
   * Whether the oven is currently cooking (any non-zero current state:
   * preheat, bake, broil, etc.)
   */
  private async isOvenRunning(): Promise<boolean> {
    const r = await this.try_get_erd_value(ERD_TYPES.UPPER_OVEN_CURRENT_STATE)
    return !!r && Number.parseInt(r, 16) !== 0
  }

  /**
   * Whether a temperature probe is physically plugged in right now — not
   * merely whether the oven supports one.
   */
  private async isProbeFitted(): Promise<boolean> {
    const r = await this.try_get_erd_value(ERD_TYPES.UPPER_OVEN_PROBE_PRESENT)
    return !!r && Number.parseInt(r, 16) === 1
  }

  /**
   * Add the probe sensor when a probe is fitted, remove it when not. Safe to
   * call repeatedly — it also runs when the oven pushes a probe-present
   * change, so plugging the probe in shows the sensor without a restart.
   */
  private async syncProbeSensor(): Promise<void> {
    if (await this.isProbeFitted()) {
      const probeTempSensor = this.accessory!.getService('Probe Temperature') ?? this.accessory!.addService(this.platform.Service.TemperatureSensor, 'Probe Temperature', 'ProbeTemp')
      this.probeTempSensor = probeTempSensor
      this.probeRemovalLogged = false
      this.setServiceName(probeTempSensor, 'Probe Temperature')
      probeTempSensor
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .setProps({ minValue: -20, maxValue: 500, minStep: 0.1 })
        .onGet(async () => {
          const r = await this.try_get_erd_value(ERD_TYPES.UPPER_OVEN_PROBE_DISPLAY_TEMP)
          if (!r) {
            return 0
          }
          return fToC(Number.parseInt(r, 16))
        })
      return
    }
    const staleProbe = this.accessory!.getService('Probe Temperature')
    if (staleProbe) {
      this.accessory!.removeService(staleProbe)
    }
    this.probeTempSensor = undefined
    if (!this.probeRemovalLogged) {
      this.probeRemovalLogged = true
      this.infoLog('No temperature probe is plugged into the oven, so the Probe Temperature tile is not shown (it appears when a probe is fitted)')
    }
  }

  /**
   * Whether any part of the cooktop is currently on. The status arrives as a
   * hex string whose first byte is the overall on/off summary; the remaining
   * per-burner bytes are not reliably populated on all models.
   */
  private async isCooktopOn(): Promise<boolean> {
    const r = await this.try_get_erd_value(ERD_TYPES.COOKTOP_STATUS)
    return !!r && Number.parseInt(r.substring(0, 2), 16) !== 0
  }

  /**
   * Add the cooktop sensor when the range reports its cooktop status. Safe to
   * call repeatedly — it also runs on a pushed status, so models that reject
   * the direct read still gain the tile the first time they push.
   */
  private async syncCooktopSensor(): Promise<void> {
    const r = await this.try_get_erd_value(ERD_TYPES.COOKTOP_STATUS)
    if (r === undefined) {
      return
    }
    const cooktopSensor = this.accessory!.getService('Cooktop') ?? this.accessory!.addService(this.platform.Service.ContactSensor, 'Cooktop', 'Cooktop')
    this.cooktopSensor = cooktopSensor
    this.setServiceName(cooktopSensor, 'Cooktop')
    cooktopSensor
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(async () => {
        // open (not detected) = cooktop on, matching the remote-enable mapping
        return await this.isCooktopOn()
          ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
      })
  }

  /**
   * Reflect a pushed ERD change in HomeKit as it happens, instead of waiting
   * for HomeKit to ask. The platform stores the pushed value in its live
   * cache before calling this, so the read helpers see fresh data (#8).
   */
  onErdUpdate(erd: string): void {
    if (this.useMatterOverride) {
      return
    }
    void this.applyLiveUpdate(erd)
  }

  private async applyLiveUpdate(erd: string): Promise<void> {
    try {
      switch (erd) {
        case ERD_TYPES.UPPER_OVEN_LIGHT: {
          const r = await this.try_get_erd_value(ERD_TYPES.UPPER_OVEN_LIGHT)
          this.ovenLight?.updateCharacteristic(this.platform.Characteristic.On, !!r && Number.parseInt(r) !== 0)
          break
        }
        case ERD_TYPES.UPPER_OVEN_RAW_TEMPERATURE:
        case ERD_TYPES.UPPER_OVEN_DISPLAY_TEMPERATURE: {
          this.ovenThermostat?.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, await this.getCavityTempC())
          break
        }
        case ERD_TYPES.UPPER_OVEN_COOK_MODE: {
          const cookMode = await this.readCookMode()
          if (cookMode && cookMode.mode !== 0 && cookMode.tempF > 0) {
            this.lastTargetTempF = cookMode.tempF
            this.ovenThermostat?.updateCharacteristic(this.platform.Characteristic.TargetTemperature, fToC(cookMode.tempF))
          }
          this.ovenThermostat?.updateCharacteristic(
            this.platform.Characteristic.TargetHeatingCoolingState,
            cookMode && cookMode.mode !== 0
              ? this.platform.Characteristic.TargetHeatingCoolingState.HEAT
              : this.platform.Characteristic.TargetHeatingCoolingState.OFF,
          )
          break
        }
        case ERD_TYPES.UPPER_OVEN_CURRENT_STATE: {
          const running = await this.isOvenRunning()
          this.ovenThermostat?.updateCharacteristic(
            this.platform.Characteristic.CurrentHeatingCoolingState,
            running
              ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
              : this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
          )
          this.cookTimeValve?.updateCharacteristic(
            this.platform.Characteristic.Active,
            running ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE,
          )
          this.cookTimeValve?.updateCharacteristic(
            this.platform.Characteristic.InUse,
            running ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE,
          )
          break
        }
        case ERD_TYPES.UPPER_OVEN_COOK_TIME_REMAINING: {
          const r = await this.try_get_erd_value(ERD_TYPES.UPPER_OVEN_COOK_TIME_REMAINING)
          const minutes = r ? Number.parseInt(r, 16) : 0
          this.cookTimeValve?.updateCharacteristic(this.platform.Characteristic.RemainingDuration, minutes * 60)
          break
        }
        // Lower cavity, double ovens only (#46)
        case ERD_TYPES.LOWER_OVEN_LIGHT: {
          const r = await this.try_get_erd_value(ERD_TYPES.LOWER_OVEN_LIGHT)
          this.lowerOvenLight?.updateCharacteristic(this.platform.Characteristic.On, !!r && Number.parseInt(r) !== 0)
          break
        }
        case ERD_TYPES.LOWER_OVEN_RAW_TEMPERATURE:
        case ERD_TYPES.LOWER_OVEN_DISPLAY_TEMPERATURE: {
          this.lowerOvenTempSensor?.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, await this.getLowerCavityTempC())
          break
        }
        case ERD_TYPES.LOWER_OVEN_CURRENT_STATE: {
          const lowerRunning = await this.isLowerOvenRunning()
          this.lowerCookTimeValve?.updateCharacteristic(
            this.platform.Characteristic.Active,
            lowerRunning ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE,
          )
          this.lowerCookTimeValve?.updateCharacteristic(
            this.platform.Characteristic.InUse,
            lowerRunning ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE,
          )
          break
        }
        case ERD_TYPES.LOWER_OVEN_COOK_TIME_REMAINING: {
          const r = await this.try_get_erd_value(ERD_TYPES.LOWER_OVEN_COOK_TIME_REMAINING)
          const minutes = r ? Number.parseInt(r, 16) : 0
          this.lowerCookTimeValve?.updateCharacteristic(this.platform.Characteristic.RemainingDuration, minutes * 60)
          break
        }
        case ERD_TYPES.LOWER_OVEN_PROBE_PRESENT: {
          await this.syncLowerProbeSensor()
          break
        }
        case ERD_TYPES.LOWER_OVEN_PROBE_DISPLAY_TEMP: {
          // The tile can be absent when the oven reports no probe-present flag
          // and the probe read cold at startup, so make sure it exists (#46)
          if (!this.lowerProbeTempSensor) {
            await this.syncLowerProbeSensor()
          }
          const r = await this.try_get_erd_value(ERD_TYPES.LOWER_OVEN_PROBE_DISPLAY_TEMP)
          this.lowerProbeTempSensor?.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, r ? fToC(Number.parseInt(r, 16)) : 0)
          break
        }
        case ERD_TYPES.UPPER_OVEN_PROBE_PRESENT: {
          await this.syncProbeSensor()
          break
        }
        case ERD_TYPES.COOKTOP_STATUS: {
          await this.syncCooktopSensor()
          this.cooktopSensor?.updateCharacteristic(
            this.platform.Characteristic.ContactSensorState,
            await this.isCooktopOn()
              ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
              : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED,
          )
          break
        }
        case ERD_TYPES.UPPER_OVEN_PROBE_DISPLAY_TEMP: {
          const r = await this.try_get_erd_value(ERD_TYPES.UPPER_OVEN_PROBE_DISPLAY_TEMP)
          this.probeTempSensor?.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, r ? fToC(Number.parseInt(r, 16)) : 0)
          break
        }
      }
    } catch (error: any) {
      this.debugLog(`Live oven update for ${erd} failed: ${error?.message ?? error}`)
    }
  }
}
function cToF(celsius: number) {
  return (celsius * 9) / 5 + 32
}
function fToC(fahrenheit: number) {
  return ((fahrenheit - 32) * 5) / 9
}
