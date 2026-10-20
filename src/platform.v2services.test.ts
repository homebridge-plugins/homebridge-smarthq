/**
 * The v2 API lists an appliance's services with their live state, which is the
 * only way to find out whether a washer reports an energy reading at all
 * (#135). These tests cover the debug listing that shows them.
 */
import type { Logging } from 'homebridge'

import { describe, expect, it, vi } from 'vitest'

import { SmartHQPlatform } from './platform.js'

function makeHost(v2: Record<string, unknown>) {
  const log = vi.fn() as unknown as Logging
  log.info = vi.fn()
  log.debug = vi.fn()
  const host: any = Object.create(SmartHQPlatform.prototype)
  host.log = log
  host.platformLogging = 'debug'
  host.v2Transport = v2
  return { host, lines: () => (log.info as any).mock.calls.map((call: unknown[]) => call.join(' ')) }
}

const washer = { type: 'Washer', applianceId: 'D828C9AB1234' }

describe('listing an appliance\'s v2 services', () => {
  it('logs each service with its state', async () => {
    const { host, lines } = makeHost({
      resolveDeviceId: async () => 'v2-washer',
      getServices: async () => [
        { serviceType: 'cloud.smarthq.service.meter', domainType: 'cloud.smarthq.domain.energy', serviceDeviceType: 'cloud.smarthq.device.washer', state: { meterValue: 1.25 } },
        { serviceType: 'cloud.smarthq.service.toggle', domainType: 'cloud.smarthq.domain.power', state: { on: true } },
      ],
    })

    await host.logV2Services(washer)

    expect(lines()).toEqual([
      '[DEBUG] v2 service of "Washer" D828C9AB1234: cloud.smarthq.service.meter domain=cloud.smarthq.domain.energy device=cloud.smarthq.device.washer state={"meterValue":1.25}',
      '[DEBUG] v2 service of "Washer" D828C9AB1234: cloud.smarthq.service.toggle domain=cloud.smarthq.domain.power device=- state={"on":true}',
    ])
  })

  it('says so when the appliance is not on the v2 API', async () => {
    const { host, lines } = makeHost({ resolveDeviceId: async () => undefined })

    await host.logV2Services(washer)

    expect(lines()).toEqual(['[DEBUG] v2 services of "Washer" D828C9AB1234: not listed on the v2 API'])
  })

  it('never lets a failed lookup stop the appliance being set up', async () => {
    const { host, lines } = makeHost({
      resolveDeviceId: async () => {
        throw new Error('401 Unauthorized')
      },
    })

    await expect(host.logV2Services(washer)).resolves.toBeUndefined()
    expect(lines()).toEqual(['[DEBUG] Could not read the v2 services of "Washer" D828C9AB1234: 401 Unauthorized'])
  })
})
