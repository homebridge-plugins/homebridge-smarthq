/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * device.ts: @homebridge-plugins/homebridge-smarthq - Unified device base class.
 */
import type { API, CharacteristicValue, HAP, Logging, PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext, SmartHQPlatformConfig } from '../settings.js'

import axios from 'axios'

import { ERD_TYPES, MAX_TIMER_MS } from '../settings.js'

/**
 * Connection-level failures that say nothing about the appliance or the ERD -
 * the request never reached the API. Worth another go rather than a warning.
 */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNABORTED', // axios' own timeout
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN', // transient DNS failure
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
])

const ERD_READ_ATTEMPTS = 3
const ERD_RETRY_DELAY_MS = 500

/**
 * ⚠️ Node tries every address a host resolves to (happy eyeballs), so a single
 * failed connect arrives as an AggregateError whose own `code` is undefined and
 * whose children hold the real codes. A host with IPv6 records on a v4-only
 * network is the common case: the v6 attempts fail ENETUNREACH instantly and
 * the v4 ones time out, and all of it lands in one message. Checking only
 * `error.code` misses all of it, so the children are checked too.
 */
export function isTransientNetworkError(error: any): boolean {
  if (!error) {
    return false
  }
  if (error.response) {
    // The API answered - whatever it said, it is not a connection problem
    return false
  }
  if (typeof error.code === 'string' && TRANSIENT_NETWORK_CODES.has(error.code)) {
    return true
  }
  if (Array.isArray(error.errors)) {
    return error.errors.some((e: any) => typeof e?.code === 'string' && TRANSIENT_NETWORK_CODES.has(e.code))
  }
  return false
}

// Type for Matter accessory (will be properly typed in Homebridge 2.0)
/**
 * Decode an ERD string value into readable text.
 *
 * ERDs carry their values as hex, so a serial number arrives as something like
 * `4D5A3132333435360000` rather than `MZ123456`, usually padded with trailing
 * nulls. Anything that is not hex is handed back as-is, on the assumption the
 * appliance answered in plain text, and anything with no printable characters
 * left in it comes back empty.
 */
export function decodeErdString(raw: string | undefined): string {
  if (typeof raw !== 'string') {
    return ''
  }
  const trimmed = raw.trim()
  if (trimmed === '') {
    return ''
  }
  const hex = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    // Not hex at all - treat it as text the appliance already decoded
    return printableOnly(trimmed)
  }
  let decoded = ''
  for (let i = 0; i < hex.length; i += 2) {
    decoded += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16))
  }
  return printableOnly(decoded)
}

/**
 * Keep only printable ASCII, then trim. Serial ERDs are null-padded, and a
 * value that decodes to nothing but padding is no serial at all.
 */
function printableOnly(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '').trim()
}

export interface MatterAccessory {
  UUID: string
  displayName: string
  serialNumber: string
  manufacturer: string
  model: string
  firmwareRevision: string
  hardwareRevision: string
  deviceType: any
  clusters?: Record<string, unknown>
  handlers?: Record<string, unknown>
  parts?: Array<MatterAccessory>
  context?: Record<string, unknown>
}

/**
 * Unified base class for SmartHQ devices supporting both HAP and Matter protocols
 * Contains all shared functionality for ERD operations, logging, configuration, and protocol handling
 */
// Devices keep their controlling class instance on the accessory itself,
// the same pattern as the other plugins in this org
declare module 'homebridge' {
  interface PlatformAccessory {
    control?: deviceBase
  }
}

export abstract class deviceBase {
  public readonly api: API
  public readonly log: Logging
  public readonly config!: SmartHQPlatformConfig
  protected readonly hap: HAP

  // Config
  protected deviceLogging!: string
  protected deviceRefreshRate!: number
  protected deviceFirmwareVersion!: string

  // ERD capability tracking - remember which ERDs are not supported
  private unsupportedErds: Set<string> = new Set()

  // ERDs that are optional on many appliance models — suppress 400 logs for these
  private optionalErds: Set<string> = new Set([
    ERD_TYPES.ICE_MAKER_CONTROL,
    ERD_TYPES.TURBO_COOL_STATUS,
    ERD_TYPES.TURBO_FREEZE_STATUS,
    ERD_TYPES.AIR_FILTER_STATUS,
    ERD_TYPES.DISHWASHER_CYCLE,
    ERD_TYPES.LAUNDRY_DOOR_LOCK,
    ERD_TYPES.UPPER_OVEN_REMOTE_ENABLED,
  ])

  // HAP-specific properties
  protected accessory?: PlatformAccessory<SmartHqContext>

  // Matter-specific properties
  protected matterAccessory?: MatterAccessory
  protected matterUuid?: string
  protected userId?: string
  protected matterRegistered: boolean = false

  // Protocol flag
  protected useMatter: boolean = false

  /**
   * Get the HAP accessory (throws if not in HAP mode)
   */
  protected get hapAccessory(): PlatformAccessory<SmartHqContext> {
    if (!this.accessory) {
      throw new Error('Accessory is not available - not in HAP mode')
    }
    return this.accessory
  }

  constructor(
    protected readonly platform: SmartHQPlatform,
    accessoryOrDevice: PlatformAccessory<SmartHqContext> | devicesConfig,
    deviceOrUserId?: devicesConfig | string,
  ) {
    // Initialize platform references
    this.api = platform.api
    this.log = platform.log
    this.config = platform.config
    this.hap = this.api.hap

    // Determine if this is HAP or Matter based on constructor arguments
    let device: devicesConfig
    let isHAP = false
    let accessoryTemp: PlatformAccessory<SmartHqContext> | undefined
    let userIdTemp: string | undefined

    if ('UUID' in accessoryOrDevice) {
      // HAP mode: first arg is PlatformAccessory
      accessoryTemp = accessoryOrDevice as PlatformAccessory<SmartHqContext>
      device = deviceOrUserId as devicesConfig
      isHAP = true
    } else {
      // Matter mode: first arg is device, second is userId
      device = accessoryOrDevice as devicesConfig
      userIdTemp = deviceOrUserId as string
    }

    // Initialize config settings
    this.getDeviceLogSettings(device)
    this.getDeviceRateSettings(device)
    this.getDeviceConfigSettings(device)

    // Set instance properties
    if (isHAP) {
      this.accessory = accessoryTemp
      this.useMatter = false
      // Initialize HAP accessory asynchronously (won't block constructor)
      this.initializeHAPAccessory().catch((error) => {
        this.log.error(`Failed to initialize HAP accessory: ${error}`)
      })
    } else {
      this.userId = userIdTemp
      this.useMatter = device.useMatter ?? false
    }
  }

  async getDeviceLogSettings(device: devicesConfig): Promise<void> {
    this.deviceLogging = device.logging ?? this.platform.platformLogging ?? 'standard'
    const logging = device.logging ? 'Device Config' : this.platform.platformLogging ? 'Platform Config' : 'Default'
    await this.debugLog(`Using ${logging} Logging: ${this.deviceLogging}`)
  }

  async getDeviceRateSettings(device: devicesConfig): Promise<void> {
    // refreshRate. Clamped in seconds here, so that every `deviceRefreshRate *
    // 1000` in the device files stays inside what a Node timer can hold. Past
    // the limit a timer does not throw - it silently drops to 1 ms, turning a
    // slow poll into a flood of calls at the SmartHQ API.
    this.deviceRefreshRate = Math.min(
      device.refreshRate ?? this.platform.platformRefreshRate ?? 360,
      MAX_TIMER_MS / 1000,
    )
    const refreshRate = device.refreshRate ? 'Device Config' : this.platform.platformRefreshRate ? 'Platform Config' : 'Default'
    await this.debugLog(`Using ${refreshRate} refreshRate: ${this.deviceRefreshRate}`)
    // updateRate used to be parsed and echoed back here, which made it look
    // accepted - it was offered in the settings, described as how often HomeKit
    // accessories are updated, and read by nothing. Every polling loop uses
    // refreshRate, which is the setting that actually controls this. pushRate was
    // the same story - parsed, stored and confirmed in the log, but read by
    // nothing, because commands are sent straight to the appliance with no
    // debounce - so it has gone the same way.
  }

  async getDeviceConfigSettings(device: devicesConfig): Promise<void> {
    const deviceConfig: Record<string, unknown> = {}
    const properties = [
      'logging',
      'refreshRate',
      'hide_device',
      'useMatter',
    ]
    properties.forEach((prop) => {
      if (device[prop] !== undefined) {
        deviceConfig[prop] = device[prop]
      }
    })
    if (Object.keys(deviceConfig).length !== 0) {
      this.infoLog(`Config: ${JSON.stringify(deviceConfig)}`)
    }
  }

  /**
   * Get and parse device firmware version
   */
  protected async parseFirmwareVersion(firmware?: string): Promise<string> {
    const deviceFirmwareVersion = firmware ?? this.platform.version ?? '0.0.0'
    const version = deviceFirmwareVersion.toString()
    this.debugLog(`Firmware Version: ${version.replace(/^V|-.*$/g, '')}`)
    if (version?.includes('.') === false) {
      const replace = version?.replace(/^V|-.*$/g, '')
      const match = replace?.match(/./g)
      const validVersion = match?.join('.')
      return validVersion ?? '0.0.0'
    } else {
      return version.replace(/^V|-.*$/g, '') ?? '0.0.0'
    }
  }

  /**
   * Initialize HAP accessory information
   */
  private async initializeHAPAccessory(): Promise<void> {
    if (!this.accessory) {
      return
    }

    // Parse firmware version first to avoid undefined values
    const device = (this.accessory.context as any).device
    const deviceFirmwareVersion = device.firmware ?? this.platform.version ?? '0.0.0'
    this.deviceFirmwareVersion = await this.parseFirmwareVersion(deviceFirmwareVersion)

    this.getDeviceContext(this.accessory, device)

    // Resolved once and written back, so the plugin's own device table in the
    // settings UI reads the same value HomeKit was given rather than the
    // "Unknown" the cloud sent
    const serialNumber = await this.resolveSerialNumber()
    this.accessory.context.device.serial = serialNumber

    // Set accessory information
    this.accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, this.accessory.context.device.brand && this.accessory.context.device.brand !== 'Unknown' ? this.accessory.context.device.brand : 'GE Appliances')
      .setCharacteristic(this.hap.Characteristic.Name, this.accessory.context.device.nickname)
      .setCharacteristic(this.hap.Characteristic.ConfiguredName, this.accessory.context.device.nickname)
      .setCharacteristic(this.hap.Characteristic.Model, this.accessory.context.device.model)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, serialNumber)
      .setCharacteristic(this.hap.Characteristic.HardwareRevision, this.deviceFirmwareVersion || '1.0.0')
      .setCharacteristic(this.hap.Characteristic.SoftwareRevision, this.deviceFirmwareVersion || '1.0.0')
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, this.deviceFirmwareVersion || '1.0.0')
      .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
      .updateValue(this.deviceFirmwareVersion || '1.0.0')
  }

  /**
   * Work out the serial number to publish, in order of how much it can be
   * trusted.
   *
   * The SmartHQ cloud sends the literal string `Unknown` rather than omitting
   * the field when it holds no serial for an appliance, which is what puts
   * "Unknown" in the Home app's device panel. A Fisher & Paykel washer came
   * through that way, so before giving up the appliance itself is asked - ERD
   * 0x0002 is its own serial number, and readErd caches a 400 so a model that
   * does not answer is asked once and never again.
   */
  protected async resolveSerialNumber(): Promise<string> {
    const device = (this.accessory?.context?.device ?? {}) as any

    // What the user typed wins: it is read off the label on the machine
    const configured = typeof device.serialNumber === 'string' ? device.serialNumber.trim() : ''
    if (configured) {
      return configured
    }

    const fromCloud = typeof device.serial === 'string' ? device.serial.trim() : ''
    if (fromCloud && fromCloud !== 'Unknown') {
      return fromCloud
    }

    const fromAppliance = decodeErdString(await this.readErd(ERD_TYPES.SERIAL_NUMBER))
    if (fromAppliance) {
      await this.debugLog(`Serial number read from the appliance: ${fromAppliance}`)
      return fromAppliance
    }

    // Nothing knows it. Hand back whatever the cloud said so the panel reads the
    // same as it always has, rather than going blank
    return fromCloud || 'Unknown'
  }

  /**
   * Get the appliance ID for ERD operations
   */
  protected getApplianceId(): string {
    if (this.accessory) {
      return this.accessory.context.device.applianceId
    }
    // Fallback for Matter mode - should be set via userId path
    return ''
  }

  /**
   * Get the user ID for ERD operations
   */
  protected getUserId(): string {
    if (this.accessory) {
      return this.accessory.context.userId
    }
    return this.userId ?? ''
  }

  /**
   * Get the device display name for logging
   */
  protected getDisplayName(): string {
    if (this.accessory) {
      return this.accessory.displayName
    }
    const protocol = this.useMatter ? 'Matter' : 'HAP'
    return `[${protocol}] SmartHQ Device`
  }

  /**
   * Logging for Device
   */
  async infoLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.info(`${this.getDisplayName()}`, String(...log))
    }
  }

  async successLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.success(`${this.getDisplayName()}`, String(...log))
    }
  }

  async debugSuccessLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debugMode') {
        this.log.debug(`${this.getDisplayName()}`, String(...log))
      } else if (this.deviceLogging === 'debug') {
        this.log.success(`[DEBUG] ${this.getDisplayName()}`, String(...log))
      }
    }
  }

  async warnLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.warn(`${this.getDisplayName()}`, String(...log))
    }
  }

  async debugWarnLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debugMode') {
        this.log.debug(`${this.getDisplayName()}`, String(...log))
      } else if (this.deviceLogging === 'debug') {
        this.log.warn(`[DEBUG] ${this.getDisplayName()}`, String(...log))
      }
    }
  }

  async errorLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.error(`${this.getDisplayName()}`, String(...log))
    }
  }

  async debugErrorLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debugMode') {
        this.log.debug(`${this.getDisplayName()}`, String(...log))
      } else if (this.deviceLogging === 'debug') {
        this.log.error(`[DEBUG] ${this.getDisplayName()}`, String(...log))
      }
    }
  }

  async debugLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debug') {
        this.log.info(`[DEBUG] ${this.getDisplayName()}`, String(...log))
      } else if (this.deviceLogging === 'debugMode') {
        this.log.debug(`${this.getDisplayName()}`, String(...log))
      }
    }
  }

  /**
   * ⚠️ True in a normal install, because 'debugMode' means "let Homebridge
   * decide" rather than "debug is on". Only ever gate 'log.debug' on this.
   *
   * Gating 'log.warn', 'log.error' or 'log.success' on it prints those lines to
   * everyone, since Homebridge shows those levels whatever its debug setting -
   * which is exactly what happened to three of the helpers above (#243).
   */
  async loggingIsDebug(): Promise<boolean> {
    return this.deviceLogging === 'debugMode' || this.deviceLogging === 'debug'
  }

  async enablingDeviceLogging(): Promise<boolean> {
    return this.deviceLogging === 'debugMode' || this.deviceLogging === 'debug' || this.deviceLogging === 'standard'
  }

  /**
   * Check if an ERD code is supported by this appliance
   */
  async has_erd_code(erd: string): Promise<boolean> {
    try {
      const value = await this.readErd(erd)
      return value !== undefined
    } catch {
      return false
    }
  }

  /**
   * Try to get an ERD value without throwing errors
   */
  async try_get_erd_value(erd: string): Promise<string | undefined> {
    try {
      return await this.readErd(erd)
    } catch {
      return undefined
    }
  }

  /**
   * Read an ERD (Electronic Refrigerator Descriptor) value from the SmartHQ API
   */
  /**
   * Called by the platform when the appliance pushes a new ERD value over the
   * websocket. Device classes that can reflect the change in HomeKit straight
   * away should override this; the default does nothing, so devices update on
   * their next read as before. The erd code arrives normalised (lowercase).
   */
  onErdUpdate(erd: string, value: string): void {
    // no live updates by default
    void erd
    void value
  }

  /**
   * GET an ERD, retrying only when the request never reached the API.
   *
   * A single blip used to cost the whole poll: the read returned undefined and
   * logged a warning that reads like a fault, so a momentary connect failure to
   * the API looked identical to a broken appliance (#119). Anything the API
   * actually answered - including a 400 for an unsupported ERD - is passed
   * straight back out, since retrying it would only repeat the same answer.
   */
  private async getErdWithRetry(erd: string): Promise<any> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await axios.get(`/appliance/${this.getApplianceId()}/erd/${erd}`)
      } catch (error: any) {
        if (attempt >= ERD_READ_ATTEMPTS || !isTransientNetworkError(error)) {
          throw error
        }
        await this.debugLog(`ERD ${erd} read attempt ${attempt} could not reach the API (${error?.code ?? error?.message}), retrying`)
        await new Promise(resolve => setTimeout(resolve, ERD_RETRY_DELAY_MS * attempt))
      }
    }
  }

  async readErd(erd: string): Promise<string | undefined> {
    // Prefer the value the appliance pushed to us over the websocket: it is
    // more current than anything we could fetch, free to read, and proves the
    // ERD works whatever the REST endpoint has previously said about it
    const liveValue = this.platform.getLiveErd(this.getApplianceId(), erd)
    if (liveValue !== undefined) {
      await this.debugLog(`ERD ${erd} value: ${liveValue} (live)`)
      return liveValue
    }

    // Check if we already know this ERD is not supported
    if (this.unsupportedErds.has(erd)) {
      return undefined
    }

    try {
      await this.debugLog(`Reading ERD ${erd}`)
      const d = await this.getErdWithRetry(erd)

      // If API returns undefined/null, return undefined without logging
      if (d.data.value === undefined || d.data.value === null) {
        return undefined
      }

      // Check if value is an object (like temperature data with fridge/freezer properties)
      // If so, stringify it so it can be parsed as JSON later
      if (typeof d.data.value === 'object') {
        const jsonValue = JSON.stringify(d.data.value)
        await this.debugLog(`ERD ${erd} returned object: ${jsonValue}`)
        return jsonValue
      }

      await this.debugLog(`ERD ${erd} value: ${d.data.value}`)
      return String(d.data.value)
    } catch (error: any) {
      // 400 means ERD not supported by this appliance model - cache and return undefined
      if (error?.response?.status === 400) {
        this.unsupportedErds.add(erd)
        // Suppress logs for known optional ERDs to avoid noisy output
        if (!this.optionalErds.has(erd)) {
          await this.debugLog(`ERD ${erd} not supported by this appliance (400) - will not retry`)
        }
        return undefined
      }
      // For other errors, log warning and return undefined. A connection error
      // reaching here has already been retried, so say so - otherwise the line
      // reads as a one-off blip that nobody tried to recover from.
      const attempts = isTransientNetworkError(error) ? ` after ${ERD_READ_ATTEMPTS} attempts` : ''
      await this.warnLog(`readErd ${erd} error${attempts}: ${error?.message ?? error}`)
      return undefined
    }
  }

  /**
   * Write an ERD (Electronic Refrigerator Descriptor) value to the SmartHQ API
   */
  async writeErd(erd: string, value: string | boolean): Promise<void> {
    // Check if we already know this ERD is not supported
    if (this.unsupportedErds.has(erd)) {
      await this.debugLog(`Skipping write to unsupported ERD ${erd}`)
      return
    }

    try {
      await this.debugLog(`Writing ERD ${erd} with value: ${value}`)
      await axios
        .post(`/appliance/${this.getApplianceId()}/erd/${erd}`, {
          kind: 'appliance#erdListEntry',
          userId: this.getUserId(),
          applianceId: this.getApplianceId(),
          erd,
          value: typeof value === 'boolean' ? (value ? '01' : '00') : value,
        })
      await this.debugLog(`Successfully wrote ERD ${erd}`)
    } catch (error: any) {
      // 400 means ERD not supported or invalid value - cache it
      if (error?.response?.status === 400) {
        this.unsupportedErds.add(erd)
        if (!this.optionalErds.has(erd)) {
          await this.debugLog(`ERD ${erd} write failed - not supported or invalid value (400) - will not retry`)
        }
      } else {
        await this.warnLog(`writeErd ${erd} error: ${error?.message ?? error}`)
      }
    }
  }

  /**
   * Get device context for HAP accessories
   */
  async getDeviceContext(accessory: PlatformAccessory, device: devicesConfig): Promise<void> {
    // Only parse firmware if not already set
    if (!this.deviceFirmwareVersion) {
      const deviceFirmwareVersion = device.firmware ?? this.platform.version ?? '0.0.0'
      this.deviceFirmwareVersion = await this.parseFirmwareVersion(deviceFirmwareVersion)
    }
    accessory.context.device.firmware = this.deviceFirmwareVersion
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.HardwareRevision, this.deviceFirmwareVersion || '1.0.0')
      .setCharacteristic(this.hap.Characteristic.SoftwareRevision, this.deviceFirmwareVersion || '1.0.0')
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, this.deviceFirmwareVersion || '1.0.0')
      .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
      .updateValue(this.deviceFirmwareVersion || '1.0.0')
    this.debugSuccessLog(`deviceFirmwareVersion: ${this.deviceFirmwareVersion}`)
  }

  /**
   * Get device firmware version for Matter devices
   */
  async getDeviceFirmwareVersion(device: devicesConfig): Promise<void> {
    const deviceFirmwareVersion = device.firmware ?? this.platform.version ?? '0.0.0'
    this.deviceFirmwareVersion = await this.parseFirmwareVersion(deviceFirmwareVersion)
    await this.debugLog(`deviceFirmwareVersion: ${this.deviceFirmwareVersion}`)
  }

  /**
   * Update HAP characteristic value and log the change
   */
  async updateCharacteristic(Service: Service, Characteristic: any, CharacteristicValue: CharacteristicValue | undefined, CharacteristicName: string): Promise<void> {
    if (!this.accessory) {
      return
    }

    if (CharacteristicValue === undefined) {
      this.debugLog(`${CharacteristicName}: ${CharacteristicValue}`)
    } else {
      Service.updateCharacteristic(Characteristic, CharacteristicValue)
      this.debugLog(`updateCharacteristic ${CharacteristicName}: ${CharacteristicValue}`)
      this.debugWarnLog(`${CharacteristicName} context before: ${this.accessory.context[CharacteristicName]}`)
      this.accessory.context[CharacteristicName] = CharacteristicValue
      this.debugWarnLog(`${CharacteristicName} context after: ${this.accessory.context[CharacteristicName]}`)
    }
  }

  /**
   * Give a service the name the Home app actually displays.
   *
   * Setting Characteristic.Name alone is not enough: the Home app ignores it
   * on secondary services and falls back to generic labels like "Switch 1",
   * "Switch 2". ConfiguredName is what the Home app reads, but it is not part
   * of most service definitions, so it is added as an optional characteristic
   * first to avoid the HAP "characteristic not in definition" warning.
   */
  protected setServiceName(service: Service, name: string): Service {
    service.setCharacteristic(this.hap.Characteristic.Name, name)
    if (!service.testCharacteristic(this.hap.Characteristic.ConfiguredName)) {
      service.addOptionalCharacteristic(this.hap.Characteristic.ConfiguredName)
    }
    service.setCharacteristic(this.hap.Characteristic.ConfiguredName, name)
    return service
  }

  /**
   * Create Matter accessory configuration
   * Should be overridden by device-specific implementations that support Matter
   */
  protected createMatterAccessory(): MatterAccessory | undefined {
    return undefined
  }

  /**
   * Get the Matter accessory instance
   */
  getMatterAccessory(): MatterAccessory | undefined {
    if (!this.matterAccessory && this.useMatter) {
      this.matterAccessory = this.createMatterAccessory()
    }
    return this.matterAccessory
  }

  /**
   * Validate Matter API availability and log details for debugging
   */
  protected validateMatterAPI(): { valid: boolean, api: any } {
    const matterAPI = (this.api as any).matter

    // Log once per plugin session
    if (!this.constructor.prototype._matterAPILogged) {
      this.infoLog('[Matter Debug] Checking Matter API availability...')
      this.infoLog(`[Matter Debug] API exists: ${!!matterAPI}`)

      if (matterAPI) {
        const apiKeys = Object.keys(matterAPI)
        this.infoLog(`[Matter Debug] API keys (${apiKeys.length}): ${apiKeys.join(', ')}`)
        this.infoLog(`[Matter Debug] uuid: ${typeof matterAPI.uuid} ${matterAPI.uuid ? '✓' : '✗'}`)
        this.infoLog(`[Matter Debug] deviceTypes: ${typeof matterAPI.deviceTypes} ${matterAPI.deviceTypes ? '✓' : '✗'}`)
        this.infoLog(`[Matter Debug] registerPlatformAccessories: ${typeof matterAPI.registerPlatformAccessories}`)

        if (matterAPI.deviceTypes && typeof matterAPI.deviceTypes === 'object') {
          const deviceTypeKeys = Object.keys(matterAPI.deviceTypes)
          this.infoLog(`[Matter Debug] Available deviceTypes (${deviceTypeKeys.length}): ${deviceTypeKeys.slice(0, 15).join(', ')}${deviceTypeKeys.length > 15 ? '...' : ''}`)
        }
      }

      this.constructor.prototype._matterAPILogged = true
    }

    // Validate required components
    if (!matterAPI) {
      return { valid: false, api: null }
    }

    if (!matterAPI.uuid || !matterAPI.deviceTypes || typeof matterAPI.registerPlatformAccessories !== 'function') {
      this.errorLog('[Matter Debug] Validation failed:')
      if (!matterAPI.uuid) {
        this.errorLog('  - uuid is missing')
      }
      if (!matterAPI.deviceTypes) {
        this.errorLog('  - deviceTypes is missing')
      }
      if (typeof matterAPI.registerPlatformAccessories !== 'function') {
        this.errorLog(`  - registerPlatformAccessories is not a function (type: ${typeof matterAPI.registerPlatformAccessories})`)
      }
      return { valid: false, api: matterAPI }
    }

    return { valid: true, api: matterAPI }
  }

  /**
   * Helper to create base Matter accessory info
   */
  protected createBaseMatterConfig() {
    const device = this.accessory ? this.accessory.context.device : {} as any
    const displayName = device.nickname || 'SmartHQ Device'
    const serialNumber = device.applianceId || 'unknown'

    // Type assertion for Matter API (will be properly typed in Homebridge 2.0)
    const matterAPI = (this.api as any).matter

    // Debug: Log Matter API structure (first device only to avoid spam)
    if (!this.constructor.prototype._matterAPILogged) {
      this.infoLog(`[Matter Debug] API available: ${!!matterAPI}`)
      if (matterAPI) {
        this.infoLog(`[Matter Debug] API keys: ${Object.keys(matterAPI).join(', ')}`)
        this.infoLog(`[Matter Debug] uuid type: ${typeof matterAPI.uuid} = ${matterAPI.uuid ? 'exists' : 'missing'}`)
        this.infoLog(`[Matter Debug] deviceTypes type: ${typeof matterAPI.deviceTypes} = ${matterAPI.deviceTypes ? 'exists' : 'missing'}`)
        this.infoLog(`[Matter Debug] registerAccessory type: ${typeof matterAPI.registerAccessory}`)

        if (matterAPI.deviceTypes) {
          const deviceTypeKeys = Object.keys(matterAPI.deviceTypes)
          this.infoLog(`[Matter Debug] Available deviceTypes (${deviceTypeKeys.length}): ${deviceTypeKeys.slice(0, 10).join(', ')}${deviceTypeKeys.length > 10 ? '...' : ''}`)
        }
      }
      this.constructor.prototype._matterAPILogged = true
    }

    // Validate Matter API is available
    if (!matterAPI || !matterAPI.uuid) {
      throw new Error('Matter API not available or incomplete')
    }

    return {
      UUID: matterAPI.uuid.generate(serialNumber),
      displayName,
      serialNumber,
      manufacturer: device.brand && device.brand !== 'Unknown' ? device.brand : 'GE Appliances',
      model: device.model || 'SmartHQ',
      firmwareRevision: this.deviceFirmwareVersion || '1.0.0',
      hardwareRevision: this.deviceFirmwareVersion || '1.0.0',
    }
  }

  /**
   * Update Matter cluster state
   */
  protected async updateMatterState(clusterName: string, attributes: Record<string, unknown>): Promise<void> {
    if (!this.matterUuid || !this.matterRegistered) {
      await this.debugLog(`Cannot update Matter state - accessory not registered yet (UUID: ${this.matterUuid}, Registered: ${this.matterRegistered})`)
      return
    }

    try {
      // Type assertion for Matter API (will be properly typed in Homebridge 2.0)
      const matterAPI = (this.api as any).matter
      if (!matterAPI || typeof matterAPI.updateAccessoryState !== 'function') {
        await this.debugLog('Matter API not available or incomplete')
        return
      }

      await matterAPI.updateAccessoryState(this.matterUuid, clusterName, attributes)
      await this.debugLog(`Updated Matter cluster ${clusterName}: ${JSON.stringify(attributes)}`)
    } catch (error: any) {
      await this.errorLog(`Failed to update Matter cluster ${clusterName}: ${error?.message ?? error}`)
    }
  }
}
