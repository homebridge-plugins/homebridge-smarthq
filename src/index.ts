/* Copyright(C) 2021-2023, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * index.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { API } from 'homebridge'

import { SmartHQPlatform } from './platform.js'
import { createSmartHQMatterPlatform } from './SmartHQMatterPlatform.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'
import { createPlatformProxy } from './utils.js'

// Register our platform with homebridge.
export default (api: API): void => {
  // The Matter platform class is created here (at runtime) rather than at module load
  // time so that the circular dependency platform.ts → @opal → @root → SmartHQMatterPlatform
  // → platform.ts is never traversed during static module evaluation.
  const SmartHQMatterPlatform = createSmartHQMatterPlatform(SmartHQPlatform)
  const ProxyCtor = createPlatformProxy(SmartHQPlatform, SmartHQMatterPlatform)
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, ProxyCtor as any)
}


export * from './settings.js'
export * from './platform.js'