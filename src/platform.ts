/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * platform.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { API, DynamicPlatformPlugin, HAP, Logging, MatterAccessory, PlatformAccessory } from 'homebridge'
import type { TokenSet } from 'openid-client'

import type { credentials, devicesConfig, options, SmartHqContext, SmartHQPlatformConfig } from './settings.js'

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
import { SmartHQCombinationWasherDryer } from './devices/combinationWasherDryer.js'
import { SmartHQDishDrawer } from './devices/dishDrawer.js'
import { SmartHQDishWasher } from './devices/dishwasher.js'
import { SmartHQHood } from './devices/hood.js'
import { decideKeurigCapability, parseHotWaterStatus, SmartHQKeurig } from './devices/keurig.js'
import { SmartHQMicrowave } from './devices/microwave.js'
import { SmartHQOven } from './devices/oven.js'
import { SmartHQRefrigerator } from './devices/refrigerator.js'
import { SmartHQWaterFilter } from './devices/waterFilter.js'
import { SmartHQWaterHeater } from './devices/waterHeater.js'
import { SmartHQWaterSoftener } from './devices/waterSoftener.js'
import getAccessToken, { refreshAccessToken } from './getAccessToken.js'
import { API_TIMEOUT_MS, API_URL, ERD_TYPES, KEEPALIVE_TIMEOUT, lookupErdName, MAX_TIMER_MS, normaliseErd, PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

const { find, keyBy } = pkg

axios.defaults.baseURL = API_URL
axios.defaults.timeout = API_TIMEOUT_MS

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
  version!: string

  // Matter support tracking
  public matterEnabled = false
  public matterAvailable = false
  public readonly matterAccessories: Map<string, MatterAccessory> = new Map()

  /**
   * Live ERD values pushed to us over the websocket, keyed by appliance id and
   * then by normalised ERD code.
   *
   * The websocket streams every ERD change as it happens, so a value that has
   * arrived this way is fresher than anything we could fetch, and reading it
   * costs nothing. Only values the appliance actually pushed are stored: an
   * ERD earns its place here by proving it reports changes, so we can never
   * freeze a value that is only available over HTTP.
   */
  private readonly erdCache: Map<string, Map<string, string>> = new Map()

  // Websocket lifecycle timers
  private wsKeepAliveTimer?: ReturnType<typeof setInterval>
  private wsReconnectTimer?: ReturnType<typeof setTimeout>

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

    // Stop everything this platform started. Without this the websocket keep-alive
    // and the pending reconnect kept firing while Homebridge tore down, and the
    // reconnect timer in particular was never cleared anywhere at all - so it woke
    // up after shutdown and opened a fresh connection.
    this.api.on('shutdown', () => this.shutdown())
  }

  /** Cancel the websocket timers and close the connection, on the way out. */
  private shutdown(): void {
    if (this.wsKeepAliveTimer) {
      clearInterval(this.wsKeepAliveTimer)
      this.wsKeepAliveTimer = undefined
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer)
      this.wsReconnectTimer = undefined
    }
    this.accessories.forEach(accessory => (accessory as any).control?.shutdown?.())
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  /**
   * This function is invoked when homebridge restores cached Matter accessories
   * from disk at startup, in the same way configureAccessory is invoked for HAP
   * accessories. The devices register their Matter accessories on every launch,
   * so this just tracks what homebridge already knows about.
   */
  configureMatterAccessory(accessory: MatterAccessory) {
    this.debugLog(`Loading cached Matter accessory: ${accessory.displayName}`)
    this.matterAccessories.set(accessory.UUID, accessory)
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.infoLog(`Loading accessory from cache: ${accessory.displayName}`)

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory as PlatformAccessory<SmartHqContext>)
  }

  /**
   * The most recent value the appliance pushed for an ERD, if any.
   */
  public getLiveErd(applianceId: string, erd: string): string | undefined {
    return this.erdCache.get(applianceId)?.get(normaliseErd(erd))
  }

  private setLiveErd(applianceId: string, erd: string, value: string) {
    const applianceErds = this.erdCache.get(applianceId) ?? new Map<string, string>()
    applianceErds.set(normaliseErd(erd), value)
    this.erdCache.set(applianceId, applianceErds)
  }

  /**
   * Forget every live value. Called when the websocket drops, because while we
   * are not listening an appliance can change without telling us, and a stale
   * value is worse than a slow one.
   */
  private clearLiveErds() {
    if (this.erdCache.size > 0) {
      this.debugLog('Discarding live ERD values while the websocket is down')
      this.erdCache.clear()
    }
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

  /**
   * The token cache lets a restart reuse the refresh token from a previous
   * login instead of doing a fresh username/password login every time. For
   * accounts with 2FA turned on this is what makes the verification code a
   * one-time step.
   */
  private tokenCachePath(): string {
    return join(this.api.user.storagePath(), 'smarthq-token.json')
  }

  private async saveTokenSet(): Promise<void> {
    try {
      const cache = { username: this.config.credentials?.username, tokenSet: this.tokenSet }
      writeFileSync(this.tokenCachePath(), JSON.stringify(cache), { mode: 0o600 })
    } catch (e: any) {
      await this.debugWarnLog(`Failed to save token cache: ${e.message ?? e}`)
    }
  }

  private loadCachedRefreshToken(): string | undefined {
    try {
      const cache = JSON.parse(readFileSync(this.tokenCachePath(), 'utf8'))
      // A saved token for a different account than the one now configured is useless
      if (cache.username !== this.config.credentials?.username) {
        return undefined
      }
      return cache.tokenSet?.refresh_token
    } catch {
      return undefined
    }
  }

  async startRefreshTokenLogic() {
    if (!this.tokenSet) {
      throw new Error('Token set is undefined')
    }

    if (this.tokenSet.refresh_token) {
      try {
        this.tokenSet = await refreshAccessToken(this.tokenSet.refresh_token)
        await this.saveTokenSet()
      } catch (e: any) {
        await this.debugErrorLog(`Failed to refresh Access Token, Error Message: ${e.message ?? e}`)

        // Handle invalid_grant error (expired/revoked refresh token)
        if (e.error === 'invalid_grant' || e.message?.includes('invalid_grant') || e.message?.includes('Invalid refresh token')) {
          await this.debugWarnLog('Refresh token is invalid or expired. Attempting to re-authenticate with username and password...')

          // Try to get a new token using username/password
          const { username, password, mfaCode } = this.config.credentials ?? {}
          if (username && password) {
            try {
              this.tokenSet = await getAccessToken(username, password, this.config.options?.region, mfaCode)
              await this.saveTokenSet()
              await this.debugSuccessLog('Successfully re-authenticated with credentials')

              // Set up axios with new token
              if (this.tokenSet.access_token) {
                axios.defaults.headers.common = {
                  Authorization: `Bearer ${this.tokenSet.access_token}`,
                }

                // Schedule next refresh
                if (this.tokenSet.expires_in) {
                  setTimeout(() => this.scheduleTokenRefresh(), this.tokenRefreshDelayMs(this.tokenSet.expires_in))
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
      setTimeout(() => this.scheduleTokenRefresh(), this.tokenRefreshDelayMs(this.tokenSet.expires_in))
    } else {
      throw new Error('Token expiration time is undefined')
    }
  }

  /**
   * Run a scheduled token refresh. The timer used to call startRefreshTokenLogic
   * directly, which throws when the refresh fails and re-auth is not possible -
   * with nothing awaiting it, that became an unhandled rejection and node ended
   * the process, so a brief GE outage at exactly the wrong moment took the bridge
   * down instead of it simply trying again.
   */
  /**
   * How long to wait before renewing the token, from the lifetime GE reports.
   *
   * The two call sites used `1000 * (expires_in - 2000)` inline. `expires_in` is
   * in seconds, so that aims to renew about 33 minutes before expiry - but on a
   * token whose lifetime is under 2000 seconds it goes negative, and a negative
   * delay fires immediately, so the plugin would renew in a tight loop against
   * the GE token endpoint. It is also unclamped at the top end, where a Node
   * timer silently drops to 1 ms and does the same thing.
   */
  private tokenRefreshDelayMs(expiresIn: number): number {
    const early = (expiresIn - 2000) * 1000
    // Never sooner than a minute, never past what a timer can hold
    return Math.min(Math.max(early, 60 * 1000), MAX_TIMER_MS)
  }

  private scheduleTokenRefresh(): void {
    this.startRefreshTokenLogic().catch(async (e: any) => {
      await this.errorLog(`Scheduled token refresh failed: ${e?.message ?? e}`)
      // Try again in five minutes rather than giving up until the next restart
      setTimeout(() => this.scheduleTokenRefresh(), 5 * 60 * 1000)
    })
  }

  /**
   * This method is used to discover the your location and devices.
   * Accessories are registered by either their DeviceClass, DeviceModel, or DeviceID
   */
  /**
   * Open the SmartHQ websocket for real-time ERD updates. The connection is
   * kept alive with a periodic ping, and if it drops (or errors) it is torn
   * down and reopened after a short delay with a freshly fetched endpoint,
   * otherwise live updates would silently stop until the next restart.
   */
  async connectWebSocket() {
    try {
      const wssData = await axios.get('/websocket')

      const connection = new ws(wssData.data.endpoint)

      connection.on('message', (data) => {
        // A malformed frame should never take down the connection handler
        let obj: any
        try {
          obj = JSON.parse(data.toString())
        } catch {
          this.debugLog(`Ignoring non-JSON websocket frame: ${data.toString().substring(0, 100)}`)
          return
        }
        this.debugLog(`data: ${JSON.stringify(obj)}`)

        if (obj.kind === 'publish#erd') {
          // Keep the pushed value even if we have no accessory for it yet, so
          // a device configured later still starts from live data
          const liveValue = typeof obj.item.value === 'object' ? JSON.stringify(obj.item.value) : String(obj.item.value)
          this.setLiveErd(obj.item.applianceId, obj.item.erd, liveValue)

          const accessory = find(this.accessories, a => a.context.device.applianceId === obj.item.applianceId)

          if (!accessory) {
            this.infoLog('Device not found in my list. Maybe we should rerun this plugin?')
            return
          }

          const erdName = lookupErdName(obj.item.erd)
          if (erdName) {
            this.debugLog(`ERD_CODES: ${erdName}`)
            this.debugLog(`obj>item>value: ${obj.item.value}`)
          }

          // Let the device reflect the change in HomeKit straight away,
          // rather than waiting to be asked (#10)
          try {
            accessory.control?.onErdUpdate(normaliseErd(obj.item.erd), liveValue)
          } catch (error) {
            this.debugLog(`onErdUpdate failed for ${obj.item.erd}: ${error}`)
          }
        }
      })

      // Without an error listener, a socket error is an unhandled 'error'
      // event which crashes the whole bridge - the close handler that
      // follows takes care of reconnecting
      connection.on('error', (err) => {
        this.warnLog(`Websocket error: ${err.message}`)
      })

      connection.on('close', (_, reason) => {
        this.debugLog(`Websocket closed: ${reason.toString()}`)

        // Anything could change while we are not listening
        this.clearLiveErds()

        // Stop pinging a closed socket
        if (this.wsKeepAliveTimer) {
          clearInterval(this.wsKeepAliveTimer)
          this.wsKeepAliveTimer = undefined
        }

        // Reconnect with a freshly fetched endpoint after a short delay
        if (!this.wsReconnectTimer) {
          this.warnLog(`Websocket connection lost, reconnecting in ${KEEPALIVE_TIMEOUT / 1000} seconds`)
          this.wsReconnectTimer = setTimeout(() => {
            this.wsReconnectTimer = undefined
            this.connectWebSocket()
          }, KEEPALIVE_TIMEOUT)
        }
      })

      connection.on('open', () => {
        connection.send(
          JSON.stringify({
            kind: 'websocket#subscribe',
            action: 'subscribe',
            resources: ['/appliance/*/erd/*'],
          }),
        )

        this.wsKeepAliveTimer = setInterval(
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

      // The endpoint fetch failed (API blip or expired session) - retry later
      // rather than giving up on live updates until the next restart
      if (!this.wsReconnectTimer) {
        this.wsReconnectTimer = setTimeout(() => {
          this.wsReconnectTimer = undefined
          this.connectWebSocket()
        }, KEEPALIVE_TIMEOUT * 2)
      }
    }
  }

  async discoverDevices() {
    try {
      const { username, password, mfaCode } = this.config.credentials ?? {}
      if (!username || !password) {
        throw new Error('Username or password is undefined')
      }

      // Prefer the refresh token saved from a previous login over a fresh
      // username/password login — it is faster, and for 2FA accounts it is
      // the only path that does not need a new verification code
      let signedInFromCache = false
      const cachedRefreshToken = this.loadCachedRefreshToken()
      if (cachedRefreshToken) {
        try {
          this.tokenSet = await refreshAccessToken(cachedRefreshToken)
          signedInFromCache = true
          await this.debugSuccessLog('Signed in using the saved token from a previous login')
        } catch (e: any) {
          await this.debugWarnLog(`Saved token no longer valid (${e.message ?? e}), falling back to username/password login`)
        }
      }

      if (!signedInFromCache) {
        try {
          this.tokenSet = await getAccessToken(username, password, this.config.options?.region, mfaCode)
        } catch (e: any) {
          await this.errorLog(`discoverDevices, Failed to get Access Token, Error Message: ${e.message ?? e}, Submit Bugs Here: https://bit.ly/smarthq-bug-report`)
          return // Stop execution if authentication fails
        }
      }
      await this.saveTokenSet()

      try {
        await this.startRefreshTokenLogic()
      } catch (e: any) {
        await this.errorLog(`discoverDevices, Failed to start Refresh Token Logic, Error Message: ${e.message ?? e}, Submit Bugs Here: https://bit.ly/smarthq-bug-report`)
        return // Stop execution if token refresh setup fails
      }

      await this.connectWebSocket()

      try {
        const devices = await axios.get('/appliance')

        const userId = devices.data.userId
        // keyBy without an iteratee uses _.identity, which collapses every
        // config entry under "[object Object]" — lookups by applianceId
        // returned undefined and hide_device was silently ignored even though
        // the fix for #83 tried to fix this same path.
        const deviceConfigByApplianceId: pkg.Dictionary<devicesConfig | undefined>
          = keyBy(this.config.devices ?? [], 'applianceId')
        for (const device of devices.data.items) {
          // Merge per-device config overrides (hide_device, keurigOnly,
          // refreshRate, etc.) from user config. The API response never
          // contains these fields, so we just copy whatever the user set.
          const deviceConfig = deviceConfigByApplianceId[device.applianceId]
          if (deviceConfig) {
            Object.assign(device, deviceConfig)
          }

          const [{ data: details }, { data: features }] = await Promise.all([
            axios.get(`/appliance/${device.applianceId}`),
            axios.get(`/appliance/${device.applianceId}/feature`),
          ])
          this.debugLog(`Device: ${JSON.stringify(device)}`)
          switch (device.type) {
            case 'Dishwasher':
              await this.createSmartHQDishWasher(userId, device, details, features)
              break
            // A Fisher & Paykel DishDrawer announces itself as 'FP DishDrawer'
            // rather than 'Dishwasher'. The string is not documented anywhere
            // and does not follow GE's own appliance-type enum, which has no
            // dish drawer at all - it came from an owner's log on a DDD196US
            // (#120). It gets its own handler rather than sharing the
            // dishwasher one: it is two independent drawers, its state lives at
            // different ERDs, and its door polarity is inverted relative to the
            // GE handler's - see dishDrawer.ts.
            case 'FP DishDrawer':
              await this.createSmartHQDishDrawer(userId, device, details, features)
              break
            case 'Oven':
              await this.createSmartHQOven(userId, device, details, features)
              break
            case 'Refrigerator':
              await this.createSmartHQRefrigerator(userId, device, details, features)
              // If the fridge has a built-in Keurig K-Cup brewer, expose
              // it as its own HomeKit accessory so Apple Home / Siri can
              // address it cleanly. Same underlying ERDs, different
              // accessory UUID.
              await this.createSmartHQKeurig(userId, device, details, features)
              break
            case 'Opal Nugget Ice Maker':
              await this.createSmartHQIceMaker(userId, device, details, features)
              break
            case 'Air Conditioner':
            case 'Portable AC':
            case 'Split Air Conditioner':
            case 'Through Wall AC':
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
            case 'Combination Washer Dryer':
              await this.createSmartHQCombinationWasherDryer(userId, device, details, features)
              break
            case 'Whole Home Water Filter':
            case 'Home Water Filter': // some filters report their type without the 'Whole' prefix (#10)
              await this.createSmartHQWaterFilter(userId, device, details, features)
              break
            case 'Whole Home Water Softener':
              await this.createSmartHQWaterSoftener(userId, device, details, features)
              break
            case 'Whole Home Water Heater':
            case 'Water Heater': // the GeoSpring reports its type without the 'Whole Home' prefix (#62)
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
              // ⚠️ Quote the type and include the model. Adding an appliance is
              // usually just another `case` here, but only if the exact string
              // the API returned is known - and an unquoted type with trailing
              // space, or a differently worded one, is impossible to spot in a
              // pasted log. Naming the model too means a single line from an
              // owner is enough to add support, instead of a round trip asking
              // for it (#120).
              await this.warnLog(`Device Type Not Supported: "${device.type}" (model ${details?.model ?? 'unknown'}). Please report this line so it can be added.`)
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
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

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
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQDishWasher(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          // Still using HAP, restore normally
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQDishWasher(this, existingAccessory, deviceData)
          await this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQDishWasher(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  /**
   * Fisher & Paykel DishDrawer. HAP only - the handler exposes two drawers and
   * there is no Matter mapping for that yet, so `useMatter` is forced off
   * rather than letting the Matter branch unregister the accessory from the
   * HAP bridge and leave nothing behind it.
   */
  private async createSmartHQDishDrawer(userId: any, device: any, details: any, features: any) {
    const deviceData = { brand: 'Fisher and Paykel', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

    deviceData.useMatter = false

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        existingAccessory.context.device = deviceData
        existingAccessory.context = { device: deviceData, userId }
        existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
        existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
        this.api.updatePlatformAccessories([existingAccessory])
        this.infoLog(`[HAP] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
        existingAccessory.control = new SmartHQDishDrawer(this, existingAccessory, deviceData)
        await this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device) {
      this.infoLog(`[HAP] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQDishDrawer(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQOven(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

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
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQOven(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQOven(this, existingAccessory, deviceData)
          await this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQOven(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQIceMaker(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

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
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQIceMaker(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          // Restore accessory
          // create the accessory handler for the restored accessory
          // this is imported from `platformAccessory.ts`
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQIceMaker(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      // the accessory does not yet exist, so we need to create it
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      accessory.control = new SmartHQIceMaker(this, accessory, deviceData)
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
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

    // `keurigOnly: true` means skip the main Refrigerator accessory but still
    // expose the Keurig sub-accessory (handled separately in createSmartHQKeurig).
    // Treat it as if hide_device were set for this dispatcher only.
    const skipMain = deviceData.hide_device || deviceData.keurigOnly === true

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      // the accessory already exists
      if (!skipMain) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQRefrigerator(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQRefrigerator(this, existingAccessory, deviceData)
          await this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!skipMain && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQRefrigerator(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  /**
   * If the refrigerator has a built-in Keurig K-Cup brewer (e.g. PYE22PYNHFS),
   * publish it as its own HomeKit accessory. Apple Home / Siri can then
   * address it cleanly instead of having the K-Cup switch lost among the
   * fridge's ~15 other services. Detection follows simbaja/ha_gehome:
   * read HOT_WATER_STATUS (0x1010) and check for a non-NA status byte.
   */
  private async createSmartHQKeurig(userId: any, device: any, details: any, features: any) {
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const keurigUuid = this.api.hap.uuid.generate(`${deviceData.applianceId}-keurig`)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === keurigUuid)

    let hasKeurig: boolean
    let probeFailed = false
    if (deviceData.keurig === false) {
      hasKeurig = false
    } else if (deviceData.keurig === true) {
      hasKeurig = true
    } else {
      try {
        const res = await axios.get(`/appliance/${deviceData.applianceId}/erd/${ERD_TYPES.HOT_WATER_STATUS}`)
        const raw = String(res.data?.value ?? '')
        hasKeurig = decideKeurigCapability(undefined, parseHotWaterStatus(raw))
        if (hasKeurig) {
          this.infoLog(`Keurig K-Cup Hot Water capability detected on ${deviceData.nickname}`)
        }
      } catch (e: any) {
        await this.debugLog(`Keurig probe failed for ${deviceData.applianceId}: ${e?.message ?? e}`)
        // A request that failed says nothing about the hardware. Treating it as
        // "no Keurig" used to unregister an already-published accessory over a
        // network blip or the fridge being offline at startup, destroying its room,
        // scenes and automations - and the next restart re-added it as a brand new
        // device the owner had to place and automate again.
        probeFailed = true
        hasKeurig = false
      }
    }

    const displayName = `${(deviceData as any).configDeviceName || deviceData.nickname} Keurig`
    const shouldRegister = hasKeurig && !deviceData.hide_device

    if (existingAccessory) {
      if (shouldRegister) {
        existingAccessory.context.device = deviceData
        existingAccessory.context = { device: deviceData, userId }
        existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'nickname', displayName)
        existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
        this.api.updatePlatformAccessories([existingAccessory])
        this.infoLog(`[HAP] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
        existingAccessory.control = new SmartHQKeurig(this, existingAccessory, deviceData)
        await this.debugLog(`${displayName} uuid: ${deviceData.applianceId}-keurig`)
      } else if (probeFailed) {
        // Only a probe that actually answered is evidence about the hardware
        await this.debugLog(`Leaving ${displayName} alone: the capability check did not answer this time`)
      } else {
        // Either no Keurig (config or auto-detect says no) or the
        // device is hidden — drop the accessory.
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (shouldRegister) {
      this.infoLog(`[HAP] Adding new accessory: ${displayName}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, keurigUuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'nickname', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQKeurig(this, accessory, deviceData)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    }
  }

  private async createSmartHQAirConditioner(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

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
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQAirConditioner(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQAirConditioner(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQAirConditioner(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQHood(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQHood(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQHood(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQHood(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQClothesWasher(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQClothesWasher(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQClothesWasher(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQClothesWasher(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQClothesDryer(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQClothesDryer(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQClothesDryer(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQClothesDryer(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQCombinationWasherDryer(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQCombinationWasherDryer(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQCombinationWasherDryer(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQCombinationWasherDryer(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQWaterFilter(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQWaterFilter(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQWaterFilter(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQWaterFilter(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQWaterSoftener(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQWaterSoftener(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQWaterSoftener(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQWaterSoftener(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQWaterHeater(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQWaterHeater(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQWaterHeater(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQWaterHeater(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQAdvantium(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQAdvantium(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQAdvantium(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQAdvantium(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(device.nickname)}`)
    }
  }

  private async createSmartHQMicrowave(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQMicrowave(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQMicrowave(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQMicrowave(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQCoffeeMaker(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQCoffeeMaker(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQCoffeeMaker(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQCoffeeMaker(this, accessory, deviceData)
      this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(deviceData.nickname)}`)
    }
  }

  private async createSmartHQBeverageCenter(userId: any, device: any, details: any, features: any) {
    // Merge device data
    // `configDeviceName` is written by the device picker in the custom UI and was
    // read by nothing, so renaming a device there had no effect at all. Resolve it
    // once here, falling back to the appliance's own nickname.
    const deviceData = { brand: 'GE', ...details, ...features, ...device }
    const displayName = (deviceData as any).configDeviceName || deviceData.nickname

    // Determine protocol (Matter or HAP)
    deviceData.useMatter = this.shouldUseMatter(deviceData)

    const uuid = this.api.hap.uuid.generate(deviceData.applianceId)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    const protocol = deviceData.useMatter ? 'Matter' : 'HAP'

    if (existingAccessory) {
      if (!deviceData.hide_device) {
        // Check if protocol changed to Matter - if so, remove from HAP bridge
        if (this.shouldUnregisterForMatter(existingAccessory, deviceData)) {
          const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
          accessory.context.device = deviceData
          accessory.context = { device: deviceData, userId }
          accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          accessory.control = new SmartHQBeverageCenter(this, accessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        } else {
          existingAccessory.context.device = deviceData
          existingAccessory.context = { device: deviceData, userId }
          existingAccessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
          existingAccessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
          this.api.updatePlatformAccessories([existingAccessory])
          this.infoLog(`[${protocol}] Restoring existing accessory from cache: ${existingAccessory.displayName}`)
          existingAccessory.control = new SmartHQBeverageCenter(this, existingAccessory, deviceData)
          this.debugLog(`${deviceData.nickname} uuid: ${deviceData.applianceId}`)
        }
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (!deviceData.hide_device && !existingAccessory) {
      this.infoLog(`[${protocol}] Adding new accessory: ${deviceData.nickname}`)
      const accessory = new this.api.platformAccessory<SmartHqContext>(displayName, uuid)
      accessory.context.device = deviceData
      accessory.context = { device: deviceData, userId }
      accessory.displayName = await this.validateAndCleanDisplayName(displayName, 'configDeviceName', displayName)
      accessory.context.device.firmware = deviceData.firmware ?? await this.getVersion()
      accessory.control = new SmartHQBeverageCenter(this, accessory, deviceData)
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
    // `debugMode` was worked out here by looking for `-D` in the plugin's own
    // process arguments. That is right in the main Homebridge process and wrong
    // in a child bridge, which only receives `-D` when that bridge has its own
    // debug setting turned on - so with debug enabled globally the plugin
    // decided debug was off and printed nothing.
    //
    // Nothing needs deciding: 'debugMode' routes debug lines to Homebridge's
    // own debug logger, which prints them only when debug is actually on, in
    // either kind of process. An explicit `logging` in the config still wins.
    this.platformLogging = (this.config.options?.logging === 'debug' || this.config.options?.logging === 'standard'
      || this.config.options?.logging === 'none')
      ? this.config.options.logging
      : 'debugMode'
    const logging = this.config.options?.logging ? 'Platform Config' : 'Default'
    await this.debugLog(`Using ${logging} Logging: ${this.platformLogging}`)
  }

  async getPlatformRateSettings() {
    // RefreshRate
    this.platformRefreshRate = this.config.options?.refreshRate ? this.config.options.refreshRate : undefined
    const refreshRate = this.config.options?.refreshRate ? 'Using Platform Config refreshRate' : 'Platform Config refreshRate Not Set'
    await this.debugLog(`${refreshRate}: ${this.platformRefreshRate}`)
  }

  async getPlatformConfigSettings() {
    if (this.config.options) {
      const platformConfig: SmartHQPlatformConfig = {
        platform: 'SmartHQ',
      }
      platformConfig.logging = this.config.options.logging ? this.config.options.logging : undefined
      platformConfig.refreshRate = this.config.options.refreshRate ? this.config.options.refreshRate : undefined
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
      if (this.platformLogging === 'debugMode') {
        this.log.debug(String(...log))
      } else if (this.platformLogging === 'debug') {
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
      if (this.platformLogging === 'debugMode') {
        this.log.debug(String(...log))
      } else if (this.platformLogging === 'debug') {
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
      if (this.platformLogging === 'debugMode') {
        this.log.debug(String(...log))
      } else if (this.platformLogging === 'debug') {
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

  /**
   * ⚠️ True in a normal install, because 'debugMode' means "let Homebridge
   * decide" rather than "debug is on". Only ever gate 'log.debug' on this.
   *
   * Gating 'log.warn', 'log.error' or 'log.success' on it prints those lines to
   * everyone, since Homebridge shows those levels whatever its debug setting -
   * which is exactly what happened to three of the helpers above (#243).
   */
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
