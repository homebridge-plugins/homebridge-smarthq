/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * device.ts: @homebridge-plugins/homebridge-smarthq - Unified device base class.
 */
import type { API, CharacteristicValue, HAP, Logging, PlatformAccessory, Service } from 'homebridge'

import type { SmartHQPlatform } from '../platform.js'
import type { devicesConfig, SmartHqContext, SmartHQPlatformConfig } from '../settings.js'

import axios from 'axios'
import { ERD_TYPES } from '../settings.js'

// Type for Matter accessory (will be properly typed in Homebridge 2.0)
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
export abstract class deviceBase {
  public readonly api: API
  public readonly log: Logging
  public readonly config!: SmartHQPlatformConfig
  protected readonly hap: HAP

  // Config
  protected deviceLogging!: string
  protected deviceRefreshRate!: number
  protected deviceUpdateRate!: number
  protected devicePushRate!: number
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
    this.deviceLogging = this.platform.debugMode ? 'debugMode' : device.logging ?? this.platform.platformLogging ?? 'standard'
    const logging = this.platform.debugMode ? 'Debug Mode' : device.logging ? 'Device Config' : this.platform.platformLogging ? 'Platform Config' : 'Default'
    await this.debugLog(`Using ${logging} Logging: ${this.deviceLogging}`)
  }

  async getDeviceRateSettings(device: devicesConfig): Promise<void> {
    // refreshRate
    this.deviceRefreshRate = device.refreshRate ?? this.platform.platformRefreshRate ?? 360
    const refreshRate = device.refreshRate ? 'Device Config' : this.platform.platformRefreshRate ? 'Platform Config' : 'Default'
    await this.debugLog(`Using ${refreshRate} refreshRate: ${this.deviceRefreshRate}`)
    // updateRate
    this.deviceUpdateRate = device.updateRate ?? this.platform.platformUpdateRate ?? 5
    const updateRate = device.updateRate ? 'Device Config' : this.platform.platformUpdateRate ? 'Platform Config' : 'Default'
    await this.debugLog(`Using ${updateRate} updateRate: ${this.deviceUpdateRate}`)
    // pushRate
    this.devicePushRate = device.pushRate ?? this.platform.platformPushRate ?? 1
    const pushRate = device.pushRate ? 'Device Config' : this.platform.platformPushRate ? 'Platform Config' : 'Default'
    await this.debugLog(`Using ${pushRate} pushRate: ${this.devicePushRate}`)
  }

  async getDeviceConfigSettings(device: devicesConfig): Promise<void> {
    const deviceConfig: Record<string, unknown> = {}
    const properties = [
      'logging',
      'refreshRate',
      'updateRate',
      'pushRate',
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

    // Set accessory information
    this.accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, this.accessory.context.device.brand && this.accessory.context.device.brand !== 'Unknown' ? this.accessory.context.device.brand : 'GE Appliances')
      .setCharacteristic(this.hap.Characteristic.Name, this.accessory.context.device.nickname)
      .setCharacteristic(this.hap.Characteristic.ConfiguredName, this.accessory.context.device.nickname)
      .setCharacteristic(this.hap.Characteristic.Model, this.accessory.context.device.model)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, this.accessory.context.device.serial)
      .setCharacteristic(this.hap.Characteristic.HardwareRevision, this.deviceFirmwareVersion || '1.0.0')
      .setCharacteristic(this.hap.Characteristic.SoftwareRevision, this.deviceFirmwareVersion || '1.0.0')
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, this.deviceFirmwareVersion || '1.0.0')
      .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
      .updateValue(this.deviceFirmwareVersion || '1.0.0')
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
      if (await this.loggingIsDebug()) {
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
      if (await this.loggingIsDebug()) {
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
      if (await this.loggingIsDebug()) {
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
  async readErd(erd: string): Promise<string | undefined> {
    // Check if we already know this ERD is not supported
    if (this.unsupportedErds.has(erd)) {
      return undefined
    }

    try {
      await this.debugLog(`Reading ERD ${erd}`)
      const d = await axios
        .get(`/appliance/${this.getApplianceId()}/erd/${erd}`)

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
      // For other errors, log warning and return undefined
      await this.warnLog(`readErd ${erd} error: ${error?.message ?? error}`)
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
      this.infoLog(`[Matter Debug] Checking Matter API availability...`)
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
