/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * platform.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { API, DynamicPlatformPlugin, HAP, Logging, PlatformAccessory } from 'homebridge'
import type { TokenSet } from 'openid-client'

import type { credentials, devicesConfig, options, SmartHqContext, SmartHQPlatformConfig } from './settings.js'

import { readFileSync } from 'node:fs'
import { argv } from 'node:process'

import axios from 'axios'
import pkg from 'lodash'
import ws from 'ws'

import { SmartHQDishWasher } from './devices/dishwasher.js'
import { SmartHQOven } from './devices/oven.js'
import { SmartHQRefrigerator } from './devices/refrigerator.js'
import getAccessToken, { refreshAccessToken } from './getAccessToken.js'
import { API_URL, ERD_CODES, ERD_TYPES, KEEPALIVE_TIMEOUT, PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

const { find } = pkg

axios.defaults.baseURL = API_URL

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class SmartHQPlatform implements DynamicPlatformPlugin {
  public accessories: PlatformAccessory<SmartHqContext>[]
  public readonly api: API
  public readonly log: Logging
  protected readonly hap: HAP
  public config!: SmartHQPlatformConfig

  public Service!: typeof this.api.hap.Service
  public Characteristic!: typeof this.api.hap.Characteristic
  private tokenSet!: TokenSet

  platformConfig!: SmartHQPlatformConfig
  platformLogging!: options['logging']
  platformRefreshRate!: options['refreshRate']
  platformPushRate!: options['pushRate']
  platformUpdateRate!: options['updateRate']
  debugMode!: boolean
  version!: string

  constructor(
    log: Logging,
    config: SmartHQPlatformConfig,
    api: API,
  ) {
    this.accessories = []
    this.api = api
    this.hap = this.api.hap
    this.log = log
    // only load if configured
    if (!config) {
      return
    }

    // Plugin options into our config variables.
    this.config = {
      platform: PLATFORM_NAME,
      name: config.name,
      credentials: config.credentials as credentials,
      devices: config.devices as devicesConfig[],
      options: config.options as options,
    }

    // Plugin Configuration
    this.getPlatformLogSettings()
    this.getPlatformRateSettings()
    this.getPlatformConfigSettings()
    this.getVersion()

    // Finish initializing the platform
    this.Service = this.api.hap.Service
    this.Characteristic = this.api.hap.Characteristic
    this.debugLog(`Finished initializing platform: ${config.name}`);

    // verify the config
    (async () => {
      try {
        await this.verifyConfig()
        await this.debugLog('Config OK')
      } catch (e: any) {
        await this.errorLog(`Verify Config, Error Message: ${e.message}, Submit Bugs Here: https://bit.ly/@homebridge-plugins/homebridge-smarthq-bug-report`)
        this.debugErrorLog(`Verify Config, Error: ${e}`)
      }
    })()

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback')
      // run the method to discover / register your devices as accessories
      try {
        await this.discoverDevices()
      } catch (e: any) {
        await this.errorLog(`Failed to Discover Devices ${JSON.stringify(e.message ?? e)}`)
      }
    })
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  async configureAccessory(accessory: PlatformAccessory<SmartHqContext>) {
    await this.infoLog(`Loading accessory from cache: ${accessory.displayName}`)

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory)
  }

  /**
   * Verify the config passed to the plugin is valid
   */
  async verifyConfig() {
    /**
     * Hidden Device Discovery Option
     * This will disable adding any device and will just output info.
     */
    this.config.logging = this.config.logging || 'standard'

    if (!this.config.refreshRate) {
      // default 3600 seconds (1 hour)
      this.config.refreshRate! = 3600
      await this.infoLog('Using Default Refresh Rate of 1 hour')
    }
  }

  async startRefreshTokenLogic() {
    if (this.tokenSet.refresh_token) {
      this.tokenSet = await refreshAccessToken(this.tokenSet.refresh_token)
    } else {
      throw new Error('Refresh token is undefined')
    }
    axios.defaults.headers.common = {
      Authorization: `Bearer ${this.tokenSet.access_token}`,
    }

    if (this.tokenSet.expires_in) {
      setTimeout(this.startRefreshTokenLogic.bind(this), 1000 * (this.tokenSet.expires_in - 2000))
    } else {
      throw new Error('Token expiration time is undefined')
    }
  }

  /**
   * This method is used to discover the your location and devices.
   * Accessories are registered by either their DeviceClass, DeviceModel, or DeviceID
   */
  async discoverDevices() {
    try {
      const { username, password } = this.config.credentials ?? {}
      if (!username || !password) {
        throw new Error('Username or password is undefined')
      }
      this.tokenSet = await getAccessToken(username, password)
      await this.startRefreshTokenLogic()

      const wssData = await axios.get('/websocket')
      const connection = new ws(wssData.data.endpoint)

      connection.on('message', (data) => {
        const obj = JSON.parse(data.toString())
        this.debugLog(`data: ${JSON.stringify(obj)}`)

        if (obj.kind === 'publish#erd') {
          const accessory = find(this.accessories, a => a.context.device.applianceId === obj.item.applianceId)

          if (!accessory) {
            this.infoLog('Device not found in my list. Maybe we should rerun this plugin?')
            return
          }

          if (ERD_CODES[obj.item.erd]) {
            this.debugLog(`ERD_CODES: ${ERD_CODES[obj.item.erd]}`)
            this.debugLog(`obj>item>value: ${obj.item.value}`)

            if (obj.item.erd === ERD_TYPES.UPPER_OVEN_LIGHT) {
              const service = accessory.getService('Upper Oven Light')
              if (service) {
                service.updateCharacteristic(this.Characteristic.On, obj.item.value === '01')
              }
            }
          }
        }
      })

      connection.on('close', (_, reason) => {
        this.debugLog('Connection closed')
        this.debugLog(`reason: ${reason.toString()}`)
      })

      connection.on('open', () => {
        connection.send(
          JSON.stringify({
            kind: 'websocket#subscribe',
            action: 'subscribe',
            resources: ['/appliance/*/erd/*'],
          }),
        )

        setInterval(
          () =>
            connection.send(
              JSON.stringify({
                kind: 'websocket#ping',
                id: 'keepalive-ping',
                action: 'ping',
              }),
            ),
          KEEPALIVE_TIMEOUT,
        )
      })

      const devices = await axios.get('/appliance')

      const userId = devices.data.userId
      for (const device of devices.data.items) {
        const [{ data: details }, { data: features }] = await Promise.all([
          axios.get(`/appliance/${device.applianceId}`),
          axios.get(`/appliance/${device.applianceId}/feature`),
        ])
        this.debugLog(`Device: ${JSON.stringify(device)}`)
        switch (device.type) {
          case 'Dishwasher':
            await this.createSmartHQDishWasher(userId, device, details, features)
            break
          case 'Oven':
            await this.createSmartHQOven(userId, device, details, features)
            break
          case 'Refrigerator':
            await this.createSmartHQRefrigerator(userId, device, details, features)
            break
          default:
            await this.warnLog(`Device Type Not Supported: ${device.type}`)
            break
        }
      }
    } catch (e: any) {
      await this.errorLog(`discoverDevices, No Device Config, Error Message: ${e.message ?? e}, Submit Bugs Here: https://bit.ly/smarthq-bug-report`)
    }
  }

  private async createSmartHQDishWasher(userId: any, device: any, details: any, features: any) {
    const uuid = this.api.hap.uuid.generate(device.applianceId)

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    if (existingAccessory) {
      // the accessory already exists
      if (!device.hide_device) {
        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.device = device
        existingAccessory.context = { device: { ...details, ...features }, userId }
        existingAccessory.displayName = await this.validateAndCleanDisplayName(device.nickname, 'nickname', device.nickname)
        existingAccessory.context.device.firmware = device.firmware ?? await this.getVersion()
        this.api.updatePlatformAccessories([existingAccessory])
        // Restore accessory
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName}`)
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new SmartHQDishWasher(this, existingAccessory, device)
        this.debugLog(`${device.nickname} uuid: ${device.applianceId}`)
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!device.hide_device && !existingAccessory) {
      this.infoLog(`Adding new accessory: ${device.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(device.nickname, uuid)

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device
      accessory.context = { device: { ...details, ...features }, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(device.nickname, 'nickname', device.nickname)
      accessory.context.device.firmware = device.firmware ?? await this.getVersion()
      // the accessory does not yet exist, so we need to create it
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new SmartHQDishWasher(this, accessory, device)
      this.debugLog(`${device.nickname} uuid: ${device.applianceId}`)

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(device.nickname)}`)
    }
  }

  private async createSmartHQOven(userId: any, device: any, details: any, features: any) {
    const uuid = this.api.hap.uuid.generate(device.applianceId)

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    if (existingAccessory) {
      // the accessory already exists
      if (!device.hide_device) {
        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.device = device
        existingAccessory.context = { device: { ...details, ...features }, userId }
        existingAccessory.displayName = await this.validateAndCleanDisplayName(device.nickname, 'nickname', device.nickname)
        existingAccessory.context.device.firmware = device.firmware ?? await this.getVersion()
        this.api.updatePlatformAccessories([existingAccessory])
        // Restore accessory
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName}`)
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new SmartHQOven(this, existingAccessory, device)
        await this.debugLog(`${device.nickname} uuid: ${device.applianceId}`)
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!device.hide_device && !existingAccessory) {
      this.infoLog(`Adding new accessory: ${device.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(device.nickname, uuid)

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device
      accessory.context = { device: { ...details, ...features }, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(device.nickname, 'nickname', device.nickname)
      accessory.context.device.firmware = device.firmware ?? await this.getVersion()
      // the accessory does not yet exist, so we need to create it
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new SmartHQOven(this, accessory, device)
      this.debugLog(`${device.nickname} uuid: ${device.applianceId}`)

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(device.nickname)}`)
    }
  }

  private async createSmartHQRefrigerator(userId: any, device: any, details: any, features: any) {
    const uuid = this.api.hap.uuid.generate(device.applianceId)

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    if (existingAccessory) {
      // the accessory already exists
      if (!device.hide_device) {
        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.device = device
        existingAccessory.context = { device: { ...details, ...features }, userId }
        existingAccessory.displayName = await this.validateAndCleanDisplayName(device.nickname, 'nickname', device.nickname)
        existingAccessory.context.device.firmware = device.firmware ?? await this.getVersion()
        this.api.updatePlatformAccessories([existingAccessory])
        // Restore accessory
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName}`)
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new SmartHQRefrigerator(this, existingAccessory, device)
        await this.debugLog(`${device.nickname} uuid: ${device.applianceId}`)
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!device.hide_device && !existingAccessory) {
      this.infoLog(`Adding new accessory: ${device.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(device.nickname, uuid)

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device
      accessory.context = { device: { ...details, ...features }, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(device.nickname, 'nickname', device.nickname)
      accessory.context.device.firmware = device.firmware ?? await this.getVersion()
      // the accessory does not yet exist, so we need to create it
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new SmartHQRefrigerator(this, accessory, device)
      this.debugLog(`${device.nickname} uuid: ${device.applianceId}`)

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(device.nickname)}`)
    }
  }

  public async unregisterPlatformAccessories(existingAccessory: PlatformAccessory) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory])
    await this.warnLog(`Removing existing accessory from cache: ${existingAccessory.displayName}`)
  }

  async getPlatformLogSettings() {
    this.debugMode = argv.includes('-D') ?? argv.includes('--debug')
    this.platformLogging = (this.config.options?.logging === 'debug' || this.config.options?.logging === 'standard'
      || this.config.options?.logging === 'none')
      ? this.config.options.logging
      : this.debugMode ? 'debugMode' : 'standard'
    const logging = this.config.options?.logging ? 'Platform Config' : this.debugMode ? 'debugMode' : 'Default'
    await this.debugLog(`Using ${logging} Logging: ${this.platformLogging}`)
  }

  async getPlatformRateSettings() {
    // RefreshRate
    this.platformRefreshRate = this.config.options?.refreshRate ? this.config.options.refreshRate : undefined
    const refreshRate = this.config.options?.refreshRate ? 'Using Platform Config refreshRate' : 'Platform Config refreshRate Not Set'
    await this.debugLog(`${refreshRate}: ${this.platformRefreshRate}`)
    // UpdateRate
    this.platformUpdateRate = this.config.options?.updateRate ? this.config.options.updateRate : undefined
    const updateRate = this.config.options?.updateRate ? 'Using Platform Config updateRate' : 'Platform Config updateRate Not Set'
    await this.debugLog(`${updateRate}: ${this.platformUpdateRate}`)
    // PushRate
    this.platformPushRate = this.config.options?.pushRate ? this.config.options.pushRate : undefined
    const pushRate = this.config.options?.pushRate ? 'Using Platform Config pushRate' : 'Platform Config pushRate Not Set'
    await this.debugLog(`${pushRate}: ${this.platformPushRate}`)
  }

  async getPlatformConfigSettings() {
    if (this.config.options) {
      const platformConfig: SmartHQPlatformConfig = {
        platform: 'SmartHQ',
      }
      platformConfig.logging = this.config.options.logging ? this.config.options.logging : undefined
      platformConfig.refreshRate = this.config.options.refreshRate ? this.config.options.refreshRate : undefined
      platformConfig.updateRate = this.config.options.updateRate ? this.config.options.updateRate : undefined
      platformConfig.pushRate = this.config.options.pushRate ? this.config.options.pushRate : undefined
      if (Object.entries(platformConfig).length !== 0) {
        await this.debugLog(`Platform Config: ${JSON.stringify(platformConfig)}`)
      }
      this.platformConfig = platformConfig
    }
  }

  /**
   * Asynchronously retrieves the version of the plugin from the package.json file.
   *
   * This method reads the package.json file located in the parent directory,
   * parses its content to extract the version, and logs the version using the debug logger.
   * The extracted version is then assigned to the `version` property of the class.
   *
   * @returns {Promise<void>} A promise that resolves when the version has been retrieved and logged.
   */
  async getVersion(): Promise<void> {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
    this.debugLog(`Plugin Version: ${version}`)
    this.version = version
  }

  /**
   * Validate and clean a string value for a Name Characteristic.
   * @param displayName - The display name of the accessory.
   * @param name - The name of the characteristic.
   * @param value - The value to be validated and cleaned.
   * @returns The cleaned string value.
   */
  async validateAndCleanDisplayName(displayName: string, name: string, value: string): Promise<string> {
    if (this.config.options?.allowInvalidCharacters) {
      return value
    } else {
      const validPattern = /^[\p{L}\p{N}][\p{L}\p{N} ']*[\p{L}\p{N}]$/u
      const invalidCharsPattern = /[^\p{L}\p{N} ']/gu
      const invalidStartEndPattern = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

      if (typeof value === 'string' && !validPattern.test(value)) {
        this.warnLog(`WARNING: The accessory '${displayName}' has an invalid '${name}' characteristic ('${value}'). Please use only alphanumeric, space, and apostrophe characters. Ensure it starts and ends with an alphabetic or numeric character, and avoid emojis. This may prevent the accessory from being added in the Home App or cause unresponsiveness.`)

        // Remove invalid characters
        if (invalidCharsPattern.test(value)) {
          const before = value
          this.warnLog(`Removing invalid characters from '${name}' characteristic, if you feel this is incorrect,  please enable \'allowInvalidCharacter\' in the config to allow all characters`)
          value = value.replace(invalidCharsPattern, '')
          this.warnLog(`${name} Before: '${before}' After: '${value}'`)
        }

        // Ensure it starts and ends with an alphanumeric character
        if (invalidStartEndPattern.test(value)) {
          const before = value
          this.warnLog(`Removing invalid starting or ending characters from '${name}' characteristic, if you feel this is incorrect, please enable \'allowInvalidCharacter\' in the config to allow all characters`)
          value = value.replace(invalidStartEndPattern, '')
          this.warnLog(`${name} Before: '${before}' After: '${value}'`)
        }
      }

      return value
    }
  }

  /**
   * If device level logging is turned on, log to log.warn
   * Otherwise send debug logs to log.debug
   */
  async infoLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.info(String(...log))
    }
  }

  async successLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.success(String(...log))
    }
  }

  async debugSuccessLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (await this.loggingIsDebug()) {
        this.log.success('[DEBUG]', String(...log))
      }
    }
  }

  async warnLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.warn(String(...log))
    }
  }

  async debugWarnLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (await this.loggingIsDebug()) {
        this.log.warn('[DEBUG]', String(...log))
      }
    }
  }

  async errorLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.error(String(...log))
    }
  }

  async debugErrorLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (await this.loggingIsDebug()) {
        this.log.error('[DEBUG]', String(...log))
      }
    }
  }

  async debugLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging === 'debugMode') {
        this.log.debug(String(...log))
      } else if (this.platformLogging === 'debug') {
        this.log.info('[DEBUG]', String(...log))
      }
    }
  }

  async loggingIsDebug(): Promise<boolean> {
    return this.platformLogging === 'debugMode' || this.platformLogging === 'debug'
  }

  async enablingPlatformLogging(): Promise<boolean> {
    return this.platformLogging === 'debugMode' || this.platformLogging === 'debug' || this.platformLogging === 'standard'
  }
}
