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
 * - If `api.isMatterAvailable()` returns true, uses the Matter platform so that
 *   `checkMatterAvailability()` can surface the correct status log (enabled,
 *   not-enabled, etc.) on every start-up.
 * - Otherwise falls back to the HAP platform (Homebridge < 2.0).
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
      // Select the Matter platform whenever Matter is available so that
      // checkMatterAvailability() (called from its constructor) can emit the
      // correct status log — including the "available but not enabled" warning.
      const matterAvailable = !disableMatter && MatterPlatform && !!((api as any)?.isMatterAvailable?.())

      if (matterAvailable) {
        this.impl = new MatterPlatform(log, config, api)
        return this.impl as any
      }

      // Fallback to HAP (Homebridge < 2.0 or disableMatter=true)
      this.impl = new HAPPlatform(log, config, api)
      return this.impl as any
    }
  } as unknown as PlatformConstructor
}
