/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * utils.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformConfig } from 'homebridge'

/**
 * Creates a proxy class that instantiates the correct platform implementation
 * (HAP or Matter) at runtime based on Matter availability and user configuration.
 *
 * - If `options.disableMatter` is true, always uses the HAP platform.
 * - If `api.isMatterAvailable()` and `api.isMatterEnabled()` are both truthy,
 *   uses the Matter platform.
 * - Otherwise falls back to the HAP platform.
 *
 * @param HAPPlatform The HAP platform class constructor.
 * @param MatterPlatform The Matter platform class constructor.
 * @returns A proxy class that delegates to the correct platform implementation.
 */
export function createPlatformProxy(HAPPlatform: any, MatterPlatform: any): any {
  return class SmartHQPlatformProxy {
    /** The instantiated platform implementation (HAP or Matter) */
    private impl: any

    constructor(log: any, config: PlatformConfig, api: any) {
      const disableMatter: boolean = config?.options?.disableMatter ?? false
      const matterAvailable = !!(api?.isMatterAvailable?.() && api?.isMatterEnabled?.())

      if (!disableMatter && MatterPlatform && matterAvailable) {
        this.impl = new MatterPlatform(log, config, api)
        return this.impl
      }

      // Fallback to HAP
      this.impl = new HAPPlatform(log, config, api)
      return this.impl
    }
  }
}
