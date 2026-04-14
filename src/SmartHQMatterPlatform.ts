/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * SmartHQMatterPlatform.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { API, PlatformAccessory } from 'homebridge'

import type { SmartHQPlatform } from './platform.js'
import type { SmartHqContext } from './settings.js'

/**
 * Minimal interface describing the HAP platform base methods and properties
 * that the Matter platform needs to access.
 */
interface SmartHQPlatformBase {
  readonly api: API
  config: { options?: { disableMatter?: boolean } }
  accessories: PlatformAccessory<SmartHqContext>[]
  infoLog(...log: any[]): Promise<void>
  warnLog(...log: any[]): Promise<void>
  debugLog(...log: any[]): Promise<void>
  configureAccessory(accessory: PlatformAccessory<SmartHqContext>): void
}

/**
 * Mixin interface that describes the Matter-specific additions made by
 * createSmartHQMatterPlatform on top of the base SmartHQPlatform class.
 */
export interface SmartHQMatterPlatformMixin {
  /** Map of Matter cached accessories restored from disk at startup */
  readonly matterAccessories: Map<string, any>
  /**
   * Called when Homebridge restores cached Matter accessories from disk at startup.
   * Stores the accessory in the matterAccessories Map for later use.
   */
  configureMatterAccessory(accessory: any): void
  /**
   * Logs the current Matter availability status.
   */
  checkMatterAvailability(): void
}

/** Constructor type returned by createSmartHQMatterPlatform */
export type SmartHQMatterPlatformConstructor = new (...args: ConstructorParameters<typeof SmartHQPlatform>) => SmartHQPlatform & SmartHQMatterPlatformMixin

/**
 * Creates the SmartHQMatterPlatform class that extends the provided HAP platform base.
 *
 * Using a factory function avoids a circular module dependency: `platform.ts` imports
 * `@opal` device modules, which import from `@root` (= `index.ts`), which would
 * otherwise cause `SmartHQPlatform` to be `undefined` at class-definition time if
 * `SmartHQMatterPlatform` had a static top-level `extends SmartHQPlatform`.
 *
 * @param Base - The HAP platform constructor to extend (SmartHQPlatform).
 * @returns SmartHQMatterPlatform constructor that creates instances of SmartHQPlatform & SmartHQMatterPlatformMixin.
 */
export function createSmartHQMatterPlatform(Base: typeof SmartHQPlatform): SmartHQMatterPlatformConstructor {
  /**
   * SmartHQMatterPlatform
   * Extends SmartHQPlatform (HAP) to add Homebridge Matter support.
   * When Matter is available and enabled in Homebridge v2.0+, the platform proxy
   * will instantiate this class instead of SmartHQPlatform directly.
   */
  class SmartHQMatterPlatform extends (Base as any) {
    /** Map of Matter cached accessories restored from disk at startup */
    public readonly matterAccessories: Map<string, any> = new Map()

    /**
     * Called when Homebridge restores cached HAP accessories from disk.
     * Delegates to the HAP platform implementation so the HAP fallback path
     * keeps the restored cache populated and avoids creating duplicates.
     */
    configureAccessory(accessory: PlatformAccessory<SmartHqContext>): void {
      super.configureAccessory(accessory)
    }

    /**
     * Called when Homebridge restores cached Matter accessories from disk at startup.
     * Stores the accessory in the matterAccessories Map for later use.
     */
    configureMatterAccessory(accessory: any): void {
      void (this as unknown as SmartHQPlatformBase).debugLog(`Loading cached Matter accessory: ${accessory.displayName}`)
      this.matterAccessories.set(accessory.UUID, accessory)
    }

    /**
     * Logs the current Matter availability status.
     * Called after the platform is instantiated to confirm Matter is active, or to
     * surface configuration issues (e.g. Matter available but not yet enabled).
     */
    checkMatterAvailability(): void {
      const self = this as unknown as SmartHQPlatformBase
      const disableMatter = self.config?.options?.disableMatter ?? false

      if (disableMatter) {
        void self.infoLog('Matter support is disabled by plugin configuration (options.disableMatter = true). Using HAP.')
        return
      }

      const extApi = self.api as API & { isMatterAvailable?(): boolean, isMatterEnabled?(): boolean }
      if (!extApi.isMatterAvailable?.()) {
        void self.debugLog('Matter is not available in this version of Homebridge. Using HAP.')
        return
      }

      if (!extApi.isMatterEnabled?.()) {
        void self.warnLog('Matter is available but not enabled in Homebridge. Enable Matter in the Homebridge settings to use Matter features.')
        return
      }

      void self.infoLog('Matter is available and enabled. SmartHQ devices will use Matter when supported.')
    }
  }

  return SmartHQMatterPlatform as unknown as SmartHQMatterPlatformConstructor
}
