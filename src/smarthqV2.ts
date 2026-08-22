/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * smarthqV2.ts: @homebridge-plugins/homebridge-smarthq - Digital Twin (v2) transport.
 */
import type { Device, ServiceMessage, SmartHQClient } from 'ge-smarthq'

import type { SmartHQPlatform } from './platform.js'

/**
 * ⚠️ ge-smarthq is loaded with a dynamic import, never a static one.
 *
 * A static import runs when this module is first required, which happens as
 * platform.ts loads — before any appliance has been looked at. If the library
 * is missing or cannot itself be imported, Homebridge reports ERROR LOADING
 * PLUGIN and every appliance goes down, not just the v2 ones. That is not
 * hypothetical: an undeclared `chalk` dependency in ge-smarthq did exactly this.
 *
 * Almost nobody running this plugin owns a v2 appliance, so they should never
 * pay for the library at all — let alone be taken offline by it. Loading it
 * lazily means a failure surfaces as one unavailable smoker, on the device that
 * asked for it, with the rest of the platform untouched.
 */
type SmartHQClientClass = typeof import('ge-smarthq')['SmartHQClient']

/**
 * Newer appliances do not publish usable state on the v1 ERD API this plugin was
 * built on. A Profile smoker (P9SBAAS6VBB) advertises `AWSMQTTERD` in its
 * capabilities and behaves accordingly: `/appliance/{id}/erd` served the same
 * 18 bytes for over 40 minutes of an active cook, its `0x62xx` mode block sat at
 * zero throughout, and the wildcard appliance-erd websocket subscription this
 * plugin makes — which acknowledges successfully — delivered nothing but
 * keepalive pongs.
 *
 * The v2 Digital Twin API carries the same appliance fully decoded: named
 * services with typed state, config ranges, and real push updates roughly once a
 * minute while cooking. This class is the seam between the two, so v2-native
 * devices can be added without disturbing the ERD path every other device uses.
 */

/**
 * A v2 service as the API returns it. The published `Device` type declares
 * `services` loosely, and the fields below are the ones this plugin relies on.
 */
export interface V2Service {
  serviceId: string
  serviceType: string
  domainType?: string
  /**
   * Which physical thing the reading belongs to. This is the ONLY way to tell
   * the smoker's two `temperature`/`measurement` services apart — they share a
   * serviceType, a domainType, and an empty config, and differ only here:
   * `cloud.smarthq.device.probe` is the meat probe,
   * `cloud.smarthq.device.smoker` the grate. Confirmed against a live cook,
   * where the probe climbed 113→123°F while the grate held 260°F.
   */
  serviceDeviceType?: string
  supportedCommands?: string[]
  state?: Record<string, any>
  config?: Record<string, any>
  lastStateTime?: string
}

export type ServiceUpdateListener = (service: ServiceMessage) => void

export class SmartHQV2 {
  private client?: SmartHQClient
  private clientClass?: SmartHQClientClass
  private connecting?: Promise<void>
  private connected = false

  /** v1 applianceId (the smoker's `updId`) -> v2 deviceId */
  private deviceIdByApplianceId = new Map<string, string>()

  /** v2 deviceId -> listeners wanting that device's pushes */
  private listeners = new Map<string, Set<ServiceUpdateListener>>()

  constructor(private readonly platform: SmartHQPlatform) {}

  /**
   * ⚠️ The plugin is the only token owner.
   *
   * `SmartHQClient.httpHeaders()` refreshes on its own whenever the token is
   * within a minute of expiring, and the plugin already runs its own refresh
   * loop against the same refresh_token. Two refreshers racing on one token
   * means whichever loses is left holding a dead one and retrying 401s — a good
   * way to get an account throttled.
   *
   * So the library is never allowed to initiate a refresh: its access token is
   * re-seeded from the plugin's current tokenSet before every call, and
   * `expires` is held far enough ahead that its own refresh check never fires.
   */
  private seedToken(clientClass: SmartHQClientClass): void {
    const tokenSet = this.platform.currentTokenSet()
    if (!tokenSet?.access_token) {
      throw new Error('No SmartHQ access token available yet')
    }
    clientClass.access_token = tokenSet.access_token
    clientClass.refresh_token = tokenSet.refresh_token ?? ''
    clientClass.expires = Date.now() + 60 * 60 * 1000
  }

  /**
   * Load ge-smarthq on first use. See the note on SmartHQClientClass for why
   * this is not a static import. The failure is reported in terms of what it
   * costs the user — one appliance — rather than as a bare module error.
   */
  private async loadClientClass(): Promise<SmartHQClientClass> {
    if (!this.clientClass) {
      try {
        const library = await import('ge-smarthq')
        this.clientClass = library.SmartHQClient
      } catch (error: any) {
        throw new Error(
          `the ge-smarthq library could not be loaded (${error?.message ?? error}), `
          + 'so appliances that need the v2 API are unavailable; every other appliance is unaffected',
        )
      }
    }
    return this.clientClass
  }

  private async getClient(): Promise<SmartHQClient> {
    const clientClass = await this.loadClientClass()
    if (!this.client) {
      // Only the library's own OAuth flow reads these, and takeOverRefresh()
      // exists precisely so that flow never runs.
      this.client = new clientClass({
        clientId: 'unused',
        clientSecret: 'unused',
        redirectUri: 'unused',
        debug: false,
      })
      this.takeOverRefresh(this.client, clientClass)
    }
    this.seedToken(clientClass)
    return this.client
  }

  /**
   * ⚠️ Replace the library's token refresh outright.
   *
   * Seeding `expires` is not enough on its own. `httpHeaders()` honours it, but
   * two other paths refresh unconditionally, whatever the expiry says:
   * `attemptReconnect()` refreshes on every websocket reconnect, and the 401
   * handlers in `getDevices()`/`getDevice()` refresh and then call themselves
   * again with no attempt cap and no delay.
   *
   * With placeholder OAuth credentials every one of those refreshes is a
   * guaranteed 401, and the self-call turns that into an unbounded loop against
   * GE's auth endpoint — which is exactly what happened the first time this
   * shipped. Handing back the plugin's own token instead makes a refresh free
   * and local: no network call, so no storm is possible however often it runs.
   *
   * ⚠️ It must NOT throw. Most calls here are routine websocket reconnects that
   * need no new token at all — the existing one is still good — and throwing
   * turned every reconnect into a permanent failure that left the socket down
   * and the accessory frozen. The runaway-retry case it was guarding against is
   * bounded at its source instead: getDevices()/getDevice() retry a 401 once.
   */
  private takeOverRefresh(client: SmartHQClient, clientClass: SmartHQClientClass): void {
    ;(client as any).refreshAccessToken = async () => {
      this.seedToken(clientClass)
      void this.platform.debugLog('v2 refresh served from the plugin token')
      return {
        access_token: clientClass.access_token,
        refresh_token: clientClass.refresh_token,
        token_type: 'Bearer',
        expires_in: 3600,
      }
    }
  }

  /**
   * Open the v2 websocket, at most once. Safe to await from several devices.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return
    }
    if (this.connecting) {
      return this.connecting
    }

    this.connecting = (async () => {
      const client = await this.getClient()

      client.on('service_update', (message: ServiceMessage) => {
        const forDevice = this.listeners.get(message.deviceId)
        if (!forDevice) {
          return
        }
        for (const listener of forDevice) {
          try {
            listener(message)
          } catch (error: any) {
            void this.platform.debugLog(`v2 service_update listener failed: ${error?.message ?? error}`)
          }
        }
      })

      client.on('connected', () => {
        this.connected = true
        void this.platform.debugLog('v2 websocket connected')
      })

      client.on('disconnected', () => {
        this.connected = false
        void this.platform.debugLog('v2 websocket disconnected')
      })

      client.on('error', (error: any) => {
        void this.platform.debugLog(`v2 websocket error: ${error?.message ?? error}`)
      })

      await client.connect()
      this.connected = true
    })()

    try {
      await this.connecting
    } finally {
      this.connecting = undefined
    }
  }

  /**
   * Resolve a v1 applianceId to its v2 deviceId. The v2 device list carries the
   * v1 id as `updId`, which is the only link between the two APIs.
   */
  async resolveDeviceId(applianceId: string): Promise<string | undefined> {
    const cached = this.deviceIdByApplianceId.get(applianceId)
    if (cached) {
      return cached
    }

    const client = await this.getClient()
    const list = await client.getDevices()
    for (const device of list.devices ?? []) {
      if ((device as any).updId) {
        this.deviceIdByApplianceId.set((device as any).updId, device.deviceId)
      }
    }
    return this.deviceIdByApplianceId.get(applianceId)
  }

  async getDevice(deviceId: string): Promise<Device> {
    const client = await this.getClient()
    return await client.getDevice(deviceId)
  }

  /**
   * Every service the device currently publishes, with its decoded state.
   */
  async getServices(deviceId: string): Promise<V2Service[]> {
    const device = await this.getDevice(deviceId)
    return ((device as any).services ?? []) as V2Service[]
  }

  /**
   * Subscribe to pushes for one device. Returns an unsubscribe function.
   */
  onServiceUpdate(deviceId: string, listener: ServiceUpdateListener): () => void {
    let forDevice = this.listeners.get(deviceId)
    if (!forDevice) {
      forDevice = new Set()
      this.listeners.set(deviceId, forDevice)
    }
    forDevice.add(listener)
    return () => {
      forDevice.delete(listener)
      if (forDevice.size === 0) {
        this.listeners.delete(deviceId)
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect()
    }
    this.connected = false
    this.listeners.clear()
  }
}
