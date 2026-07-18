/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * oven.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext } from '../settings.js'

import { ERD_TYPES } from '../settings.js'
import { deviceBase } from './device.js'

export class SmartHQOven extends deviceBase {
  // Matter support override flag
  private useMatterOverride: boolean = false

  // HAP services kept for live websocket updates (#8)
  private ovenLight?: Service
  private ovenTempSensor?: Service
  private probeTempSensor?: Service
  private cookTimeValve?: Service
  private probeRemovalLogged: boolean = false

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
      if (this.device.matterOnly) {
        this.errorLog('Matter OvenDevice device type not available - accessory will NOT be published (matterOnly mode enabled)')
        this.errorLog('Reason: Required Matter device type "OvenDevice" is not available in this Homebridge version')
        this.errorLog(`Available Matter device types: ${Object.keys(matterAPI.deviceTypes).join(', ')}`)
        return
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
      ovenLight.setCharacteristic(this.platform.Characteristic.Name, 'Oven Light')
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

    // Oven Current Temperature Sensor: shows the ACTUAL cavity temperature,
    // not the cook-mode target it used to show — the target regularly exceeds
    // HomeKit's default 100°C sensor maximum, which clamped a 350°F setpoint
    // to 100°C and displayed it as a baffling 212°F (#8)
    const ovenTempSensor = this.accessory!.getService('Oven Temperature') ?? this.accessory!.addService(this.platform.Service.TemperatureSensor, 'Oven Temperature', 'OvenTemp')
    this.ovenTempSensor = ovenTempSensor
    ovenTempSensor.setCharacteristic(this.platform.Characteristic.Name, 'Oven Temperature')
    ovenTempSensor
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

    // Probe Temperature Sensor: only when a probe is actually plugged in —
    // checking mere ERD support left a permanent 0° sensor on probe-capable
    // ovens with no probe fitted (#8)
    ;(async () => {
      await this.syncProbeSensor()
    })()

    // Cook Time valve: on/off now reflects whether the oven is actually
    // cooking (UPPER_OVEN_CURRENT_STATE) — it used to key off the cook TIMER,
    // so an untimed bake showed as "off" the whole time (#8). The remaining
    // duration still comes from the timer when one is set.
    const cookTimeValve = this.accessory!.getService('Cook Time') ?? this.accessory!.addService(this.platform.Service.Valve, 'Cook Time', 'CookTime')
    this.cookTimeValve = cookTimeValve
    cookTimeValve.setCharacteristic(this.platform.Characteristic.Name, 'Cook Time')
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
      remoteEnabledSensor.setCharacteristic(this.platform.Characteristic.Name, 'Remote Enabled')
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
      probeTempSensor.setCharacteristic(this.platform.Characteristic.Name, 'Probe Temperature')
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

}
/*
function cToF(celsius: number) {
  return (celsius * 9) / 5 + 32
}
*/
function fToC(fahrenheit: number) {
  return ((fahrenheit - 32) * 5) / 9
}
