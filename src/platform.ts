/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * platform.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { API, DynamicPlatformPlugin, HAP, Logging, PlatformAccessory } from 'homebridge'
import type { TokenSet } from 'openid-client'

import type { credentials, devicesConfig, options, SmartHqContext, SmartHQPlatformConfig } from './settings.js'

import { readFileSync } from 'node:fs'
import { argv } from 'node:process'

import { SmartHQIceMaker } from '@opal/index.js'
import axios from 'axios'
import pkg from 'lodash'
import ws from 'ws'

import { SmartHQAdvantium } from './devices/advantium.js'
import { SmartHQAirConditioner } from './devices/airConditioner.js'
import { SmartHQBeverageCenter } from './devices/beverageCenter.js'
import { SmartHQClothesDryer } from './devices/clothesDryer.js'
import { SmartHQClothesWasher } from './devices/clothesWasher.js'
import { SmartHQCoffeeMaker } from './devices/coffeeMaker.js'
import { SmartHQDishWasher } from './devices/dishwasher.js'
import { SmartHQHood } from './devices/hood.js'
import { SmartHQMicrowave } from './devices/microwave.js'
import { SmartHQOven } from './devices/oven.js'
import { SmartHQRefrigerator } from './devices/refrigerator.js'
import { SmartHQWaterFilter } from './devices/waterFilter.js'
import { SmartHQWaterHeater } from './devices/waterHeater.js'
import { SmartHQWaterSoftener } from './devices/waterSoftener.js'
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

  // Matter support tracking
  public matterEnabled = false
  public matterAvailable = false

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
      deviceOptions: config.deviceOptions,
    }

    // Plugin Configuration
    this.getPlatformLogSettings()
    this.getPlatformRateSettings()
    this.getPlatformConfigSettings()
    this.getVersion()

    // Finish initializing the platform
    this.Service = this.api.hap.Service
    this.Characteristic = this.api.hap.Characteristic
    this.debugLog(`Finished initializing platform: ${config.name}`)

    // Check Matter availability and enabled status
    this.checkMatterSupport();

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
  configureAccessory(accessory: PlatformAccessory) {
    this.infoLog(`Loading accessory from cache: ${accessory.displayName}`)

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory as PlatformAccessory<SmartHqContext>)
  }

  /**
   * Verify the config passed to the plugin is valid
   */
  async verifyConfig() {
    if (!this.config.credentials) {
      throw new Error('No Credentials Found')
    } else {
      if (!this.config.credentials.username) {
        throw new Error('No Username Found')
      }
      if (!this.config.credentials.password) {
        throw new Error('No Password Found')
      }
    }
  }

  async startRefreshTokenLogic() {
    if (!this.tokenSet) {
      throw new Error('Token set is undefined')
    }

    if (this.tokenSet.refresh_token) {
      try {
        this.tokenSet = await refreshAccessToken(this.tokenSet.refresh_token)
      } catch (e: any) {
        await this.debugErrorLog(`Failed to refresh Access Token, Error Message: ${e.message ?? e}`)

        // Handle invalid_grant error (expired/revoked refresh token)
        if (e.error === 'invalid_grant' || e.message?.includes('invalid_grant') || e.message?.includes('Invalid refresh token')) {
          await this.debugWarnLog('Refresh token is invalid or expired. Attempting to re-authenticate with username and password...')

          // Try to get a new token using username/password
          const { username, password } = this.config.credentials ?? {}
          if (username && password) {
            try {
              this.tokenSet = await getAccessToken(username, password)
              await this.debugSuccessLog('Successfully re-authenticated with credentials')

              // Set up axios with new token
              if (this.tokenSet.access_token) {
                axios.defaults.headers.common = {
                  Authorization: `Bearer ${this.tokenSet.access_token}`,
                }

                // Schedule next refresh
                if (this.tokenSet.expires_in) {
                  setTimeout(this.startRefreshTokenLogic.bind(this), 1000 * (this.tokenSet.expires_in - 2000))
                }
                return // Successfully recovered
              }
            } catch (reAuthError: any) {
              await this.errorLog(`Failed to re-authenticate: ${reAuthError.message ?? reAuthError}`)
              await this.errorLog('Please verify your SmartHQ credentials are correct in the Homebridge config')
              await this.errorLog('You may need to log in to the GE SmartHQ app to ensure your account is active')
            }
          } else {
            await this.errorLog('No credentials available for re-authentication')
            await this.errorLog('Please ensure username and password are set in your Homebridge config')
          }
        }

        await this.errorLog('Submit Bugs Here: https://bit.ly/smarthq-bug-report')
        throw e // Re-throw to stop execution only if recovery failed
      }
    } else {
      throw new Error('Refresh token is undefined')
    }

    if (!this.tokenSet.access_token) {
      throw new Error('Access token is undefined after refresh')
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
      try {
        this.tokenSet = await getAccessToken(username, password)
      } catch (e: any) {
        await this.errorLog(`discoverDevices, Failed to get Access Token, Error Message: ${e.message ?? e}, Submit Bugs Here: https://bit.ly/smarthq-bug-report`)
        return // Stop execution if authentication fails
      }

      try {
        await this.startRefreshTokenLogic()
      } catch (e: any) {
        await this.errorLog(`discoverDevices, Failed to start Refresh Token Logic, Error Message: ${e.message ?? e}, Submit Bugs Here: https://bit.ly/smarthq-bug-report`)
        return // Stop execution if token refresh setup fails
      }

      try {
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
      } catch (e: any) {
        await this.errorLog(`discoverDevices, Failed to get Websocket Data, Error Message: ${e.message ?? e}, Submit Bugs Here: https://bit.ly/smarthq-bug-report`)
      }

      try {
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
            case 'Opal Nugget Ice Maker':
              await this.createSmartHQIceMaker(userId, device, details, features)
              break
            case 'Air Conditioner':
            case 'Portable AC':
            case 'Split Air Conditioner':
              await this.createSmartHQAirConditioner(userId, device, details, features)
              break
            case 'Hood':
              await this.createSmartHQHood(userId, device, details, features)
              break
            case 'Clothes Washer':
              await this.createSmartHQClothesWasher(userId, device, details, features)
              break
            case 'Clothes Dryer':
              await this.createSmartHQClothesDryer(userId, device, details, features)
              break
            case 'Whole Home Water Filter':
              await this.createSmartHQWaterFilter(userId, device, details, features)
              break
            case 'Whole Home Water Softener':
              await this.createSmartHQWaterSoftener(userId, device, details, features)
              break
            case 'Whole Home Water Heater':
              await this.createSmartHQWaterHeater(userId, device, details, features)
              break
            case 'Advantium':
              await this.createSmartHQAdvantium(userId, device, details, features)
              break
            case 'Microwave':
              await this.createSmartHQMicrowave(userId, device, details, features)
              break
            case 'Coffee Maker':
            case 'Espresso Maker':
              await this.createSmartHQCoffeeMaker(userId, device, details, features)
              break
            case 'Beverage Center':
              await this.createSmartHQBeverageCenter(userId, device, details, features)
              break
            default:
              await this.warnLog(`Device Type Not Supported: ${device.type}`)
              break
          }
        }
      } catch (e: any) {
        await this.errorLog(`discoverDevices, Failed to get Devices Data, Error Message: ${e.message ?? e}, Submit Bugs Here: https://bit.ly/smarthq-bug-report`)
      }
    } catch (e: any) {
      await this.errorLog(`discoverDevices, No Device Config, Error Message: ${e.message ?? e}, Submit Bugs Here: https://bit.ly/smarthq-bug-report`)
    }
  }

  private async createSmartHQDishWasher(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      // the accessory already exists
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          // Device removed from HAP, will be registered as Matter accessory in device class
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQDishWasher(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          // Still using HAP, restore normally
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQDishWasher(this, existingAccessory, deviceData)
          await this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQDishWasher(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQOven(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      // the accessory already exists
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQOven(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQOven(this, existingAccessory, deviceData)
          await this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQOven(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQIceMaker(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      // the accessory already exists
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQIceMaker(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          // Restore accessory
          // create the accessory handler for the restored accessory
          // this is imported from `platformAccessory.ts`
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQIceMaker(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      // the accessory does not yet exist, so we need to create it
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new SmartHQIceMaker(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  /**
   * Create Refrigerator accessory (unified HAP/Matter)
   * The SmartHQRefrigerator class now handles both protocols internally
   */
  private async createSmartHQRefrigerator(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      // the accessory already exists
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQRefrigerator(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQRefrigerator(this, existingAccessory, deviceData)
          await this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQRefrigerator(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQAirConditioner(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      // the accessory already exists
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQAirConditioner(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQAirConditioner(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQAirConditioner(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQHood(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQHood(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQHood(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQHood(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQClothesWasher(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQClothesWasher(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQClothesWasher(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQClothesWasher(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQClothesDryer(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQClothesDryer(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQClothesDryer(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQClothesDryer(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQWaterFilter(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQWaterFilter(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQWaterFilter(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQWaterFilter(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQWaterSoftener(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQWaterSoftener(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQWaterSoftener(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQWaterSoftener(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQWaterHeater(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQWaterHeater(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQWaterHeater(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQWaterHeater(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQAdvantium(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQAdvantium(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQAdvantium(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQAdvantium(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(device.nickname)}`)
    }
  }

  private async createSmartHQMicrowave(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQMicrowave(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQMicrowave(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQMicrowave(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQCoffeeMaker(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQCoffeeMaker(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQCoffeeMaker(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQCoffeeMaker(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQBeverageCenter(userId: any, device: any, details: any, features: any) {
    // Merge device data
    const deviceData = { brand: 'GE', ...details, ...features, ...device }

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          new SmartHQBeverageCenter(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          new SmartHQBeverageCenter(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(deviceData.nickname, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(deviceData.nickname, 'nickname', deviceData.nickname)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      new SmartHQBeverageCenter(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
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
    this.platformUpdateRate = this.config.options?.updateRate ? (this.config.options.updateRate * 1000) : undefined
    const updateRateMsg = this.config.options?.updateRate ? 'Using Platform Config updateRate' : 'Platform Config updateRate Not Set'
    await this.debugLog(`${updateRateMsg}: ${this.platformUpdateRate}`)
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

  /**
   * Check if Matter is available and enabled in Homebridge
   */
  checkMatterSupport(): void {
    // Check if Matter API is available (Homebridge 2.0+)
    const api = this.api as any
    if (typeof api.isMatterAvailable === 'function') {
      this.matterAvailable = api.isMatterAvailable()
      if (!this.matterAvailable) {
        this.log.warn('Matter is not available in this version of Homebridge. Please update to Homebridge 2.0.0-beta.63 or later to use Matter.')
      }
    } else {
      this.log.debug('Matter API not detected - running on Homebridge < 2.0.0')
    }

    // Check if Matter is enabled by user
    if (this.matterAvailable && typeof api.isMatterEnabled === 'function') {
      this.matterEnabled = api.isMatterEnabled()
      if (!this.matterEnabled) {
        this.log.warn('Matter is available but not enabled. Please enable Matter in Homebridge settings to use Matter devices.')
      } else {
        this.log.info('✓ Matter is available and enabled - devices will use Matter protocol')
      }
    }

    // Log final status
    if (this.matterAvailable && this.matterEnabled) {
      this.log.success('Matter support: ENABLED - Devices will register as Matter accessories')
    } else {
      this.log.info('Matter support: DISABLED - Devices will register as HAP accessories')
    }
  }

  /**
   * Determine if a device should use Matter based on platform and device config
   */
  shouldUseMatter(device: devicesConfig): boolean {
    // If Matter isn't available or enabled, use HAP
    if (!this.matterAvailable || !this.matterEnabled) {
      return false
    }

    // Check per-device preference (if specified in config)
    if (device.useMatter !== undefined) {
      return device.useMatter
    }

    // Default: use Matter when available
    return true
  }

  /**
   * Handle accessory that needs to switch from HAP to Matter
   * Returns true if accessory was unregistered and needs to be recreated
   */
  shouldUnregisterForMatter(existingAccessory: PlatformAccessory<SmartHqContext>, deviceData: devicesConfig & { useMatter?: boolean }): boolean {
    if (deviceData.useMatter && existingAccessory) {
      this.infoLog(`Removing ${existingAccessory.displayName} from HAP bridge (switching to Matter)`)
      this.unregisterPlatformAccessories(existingAccessory)
      return true
    }
    return false
  }
}
