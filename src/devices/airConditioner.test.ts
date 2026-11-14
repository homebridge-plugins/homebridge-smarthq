import { describe, expect, it, vi } from 'vitest'

import { SmartHQAirConditioner } from './airConditioner.js'

/**
 * Some air conditioners report no filter status at all. Throwing for that
 * aborted every refresh at the filter step, so nothing after it was updated,
 * and logged the same pair of errors every refresh interval (#137).
 */
describe('an air conditioner with no filter status', () => {
  function acWithFilterErd(value: string | undefined) {
    const ac = Object.create(SmartHQAirConditioner.prototype)
    ac.filterStatusSupported = true
    ac.accessory = {
      displayName: 'Air Conditioner',
      context: { device: {} },
    }
    ac.readErd = vi.fn(async () => value)
    ac.platform = {
      log: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      Characteristic: {
        FilterChangeIndication: { FILTER_OK: 0, CHANGE_FILTER: 1 },
      },
      api: {
        hap: {
          HapStatusError: class extends Error {},
          HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 },
        },
      },
    }
    return ac
  }

  it('reports the filter as fine instead of failing', async () => {
    const ac = acWithFilterErd(undefined)

    await expect(ac.handleGetFilterChangeIndication()).resolves.toBe(0)
    expect(ac.platform.log.error).not.toHaveBeenCalled()
  })

  it('stops asking after the first empty answer, and says so once', async () => {
    const ac = acWithFilterErd(undefined)

    await ac.handleGetFilterChangeIndication()
    await ac.handleGetFilterChangeIndication()

    expect(ac.readErd).toHaveBeenCalledTimes(1)
    expect(ac.platform.log.info).toHaveBeenCalledTimes(1)
  })
})
