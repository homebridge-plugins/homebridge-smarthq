/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * server.ts: @homebridge-plugins/homebridge-smarthq.
 */
import fs from 'node:fs'

import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils'

import { ENERGY_MODELS, ENERGY_MODELS_BY_APPLIANCE_TYPE } from '../devices/energy/models.js'
import { PLUGIN_NAME } from '../settings.js'

class PluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super()
    /*
      A native method getCachedAccessories() was introduced in config-ui-x v4.37.0
      The following is for users who have a lower version of config-ui-x
    */
    const getCachedAccessories = () => {
      try {
        const plugin = PLUGIN_NAME ?? '@homebridge-plugins/homebridge-smarthq'
        const devicesToReturn = []

        // The path and file of the cached accessories
        const accFile = `${this.homebridgeStoragePath}/accessories/cachedAccessories`

        // Check the file exists
        if (fs.existsSync(accFile)) {
          // read the cached accessories file
          const cachedAccessories: any[] = JSON.parse(fs.readFileSync(accFile, 'utf8'))

          cachedAccessories.forEach((accessory: any) => {
            // Check the accessory is from this plugin
            if (accessory.plugin === plugin) {
              // Add the cached accessory to the array
              devicesToReturn.push(accessory.accessory as never)
            }
          })
        }
        // Return the array
        return devicesToReturn
      } catch {
        // Just return an empty accessory list in case of any errors
        return []
      }
    }
    // Requests are matched on the exact path, and the page asks for
    // '/getCachedAccessories' - the old unslashed name never matched it
    this.onRequest('/getCachedAccessories', getCachedAccessories)
    this.onRequest('getCachedAccessories', getCachedAccessories)

    /*
      The Energy dashboard. The plugin writes smarthq-energy-status.json every
      30 seconds while any energy tile is on (live watts, readings, history),
      because this server runs in its own process and cannot reach the plugin.
    */
    this.onRequest('/energy/status', () => {
      const file = `${this.homebridgeStoragePath}/smarthq-energy-status.json`
      try {
        if (!fs.existsSync(file)) {
          return { found: false }
        }
        const status = JSON.parse(fs.readFileSync(file, 'utf8'))
        return {
          found: true,
          readAt: Date.now(),
          status,
        }
      } catch (error: any) {
        return { found: false, error: `Could not read the energy status file: ${error?.message ?? error}` }
      }
    })

    // What the Devices sub-tab needs to show each appliance's default wattages
    // before its energy tile has ever been switched on
    this.onRequest('/energy/models', () => ({
      byApplianceType: ENERGY_MODELS_BY_APPLIANCE_TYPE,
      models: Object.fromEntries(Object.values(ENERGY_MODELS).map(m => [
        m.key,
        {
          label: m.label,
          defaults: m.defaults,
          fixed: m.fixed === true,
          alwaysOn: m.alwaysOn === true,
        },
      ])),
    }))
    this.ready()
  }
}

function startPluginUiServer(): PluginUiServer {
  return new PluginUiServer()
}

startPluginUiServer()
