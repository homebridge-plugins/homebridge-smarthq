/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * utils.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { API, DynamicPlatformPlugin, Logging, PlatformConfig } from 'homebridge'

/** Constructor type for a DynamicPlatformPlugin */
type PlatformConstructor = new (log: Logging, config: PlatformConfig, api: API) => DynamicPlatformPlugin

/**
 * Creates a proxy class that instantiates the correct platform implementation
 * (HAP or Matter) at runtime based on Matter availability and user configuration.
 *
 * - If `options.disableMatter` is true, always uses the HAP platform.
 * - If `api.isMatterAvailable()` and `api.isMatterEnabled()` are both truthy,
 *   uses the Matter platform.
 * - Otherwise falls back to the HAP platform.
 *
 * Note: The constructor returns `this.impl` directly (via `return this.impl`).
 * This is intentional — it is the standard homebridge platform-proxy pattern used
 * by homebridge-rainbird and homebridge-switchbot, where the outer proxy class is
 * transparent and the returned instance is the chosen platform implementation.
 *
 * @param HAPPlatform The HAP platform class constructor.
 * @param MatterPlatform The Matter platform class constructor.
 * @returns A proxy class that delegates to the correct platform implementation.
 */
export function createPlatformProxy(HAPPlatform: PlatformConstructor, MatterPlatform: PlatformConstructor): PlatformConstructor {
  return class SmartHQPlatformProxy {
    /** The instantiated platform implementation (HAP or Matter) */
    private impl: DynamicPlatformPlugin

    constructor(log: Logging, config: PlatformConfig, api: API) {
      const disableMatter: boolean = (config as any)?.options?.disableMatter ?? false
      const matterAvailable = !!((api as any)?.isMatterAvailable?.() && (api as any)?.isMatterEnabled?.())

      if (!disableMatter && MatterPlatform && matterAvailable) {
        this.impl = new MatterPlatform(log, config, api)
        return this.impl as any
      }

      // Fallback to HAP
      this.impl = new HAPPlatform(log, config, api)
      return this.impl as any
    }
  } as unknown as PlatformConstructor
}
