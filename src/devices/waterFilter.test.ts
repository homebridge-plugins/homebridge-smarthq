import { describe, expect, it, vi } from 'vitest'

import { SmartHQWaterFilter } from './waterFilter.js'

/**
 * #118: an owner watched the filter life fall from 30% to 0% in the Homebridge
 * accessories view and never saw it in the Home app.
 *
 * Two things were wrong on the accessory. It builds a valve, a filter, a leak
 * sensor and optionally a battery, and said which of the four its tile should
 * lead with - so the Home app picked. And the filter service had no parent:
 * the Home app shows filter life as part of the accessory it belongs to, and a
 * filter service on its own belongs to nothing.
 */

function makeService(displayName: string) {
  const chars = new Map<string, { name: string, value: unknown, onGet: () => unknown, onSet: () => unknown, updateValue: (next: unknown) => unknown }>()
  const characteristic = (name: string) => ({
    name,
    value: 0 as unknown,
    onGet() {
      return this
    },
    onSet() {
      return this
    },
    updateValue(next: unknown) {
      this.value = next
      return this
    },
  })
  return {
    displayName,
    isPrimary: undefined as boolean | undefined,
    linked: [] as { displayName: string }[],
    getCharacteristic(name: string) {
      if (!chars.has(name)) {
        chars.set(name, characteristic(name))
      }
      return chars.get(name)!
    },
    setCharacteristic(name: string, value: unknown) {
      this.getCharacteristic(name).value = value
      return this
    },
    updateCharacteristic(name: string, value: unknown) {
      this.getCharacteristic(name).value = value
      return this
    },
    testCharacteristic: (name: string) => chars.has(name),
    addOptionalCharacteristic(name: string) {
      return this.getCharacteristic(name)
    },
    setPrimaryService(isPrimary = true) {
      this.isPrimary = isPrimary
      return this
    },
    addLinkedService(service: { displayName: string }) {
      this.linked.push(service)
      return this
    },
  }
}

type FakeService = ReturnType<typeof makeService>

function makeAccessory() {
  const services = new Map<string, FakeService>()
  // the base class stamps firmware onto this one as soon as it is constructed
  services.set('AccessoryInformation', makeService('AccessoryInformation'))
  return {
    UUID: 'test-uuid',
    displayName: 'Water Filter',
    context: { device: { features: [] } },
    getService: (name: string) => services.get(name),
    addService(_type: string, name: string) {
      const service = makeService(name)
      services.set(name, service)
      return service
    },
    removeService(service: FakeService) {
      services.delete(service.displayName)
    },
    services,
  }
}

function makePlatform() {
  const proxy = new Proxy({}, { get: (_target, prop) => prop }) as any
  return {
    api: { hap: { Characteristic: proxy, Service: proxy } },
    log: Object.assign(vi.fn(), { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), success: vi.fn() }),
    config: { devices: [] },
    Characteristic: proxy,
    Service: proxy,
  } as any
}

function build(showFilterBattery = false) {
  const accessory = makeAccessory()
  const device = { applianceId: 'A1', showFilterBattery } as any
  const platform = makePlatform()
  platform.config.devices = [device]
  const filter = new SmartHQWaterFilter(platform, accessory as any, device)
  return { accessory, filter }
}

describe('a water filter in the home app', () => {
  it('leads the tile with the valve, the one control an owner can act on', () => {
    const { accessory } = build()

    expect(accessory.services.get('Water Flow')!.isPrimary).toBe(true)
    expect(accessory.services.get('Water Filter')!.isPrimary).not.toBe(true)
    expect(accessory.services.get('Water Leak')!.isPrimary).not.toBe(true)
  })

  it('gives the filter service a parent, so its life has somewhere to show', () => {
    const { accessory } = build()

    const linked = accessory.services.get('Water Flow')!.linked.map(service => service.displayName)
    expect(linked).toContain('Water Filter')
  })

  it('links the filter battery too, when an owner has asked for one', () => {
    const { accessory } = build(true)

    const linked = accessory.services.get('Water Flow')!.linked.map(service => service.displayName)
    expect(linked).toContain('Filter Life')
  })

  it('does not build a battery nobody asked for', () => {
    const { accessory } = build()

    expect(accessory.services.get('Filter Life')).toBeUndefined()
  })
})
