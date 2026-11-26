import { describe, expect, it, vi } from 'vitest'

import { brewSettingsValue, erdFlag, SmartHQCoffeeMaker, waterTempCelsius } from './coffeeMaker.js'
import { ENERGY_MODELS_BY_APPLIANCE_TYPE } from './energy/models.js'

describe('coffee brewer erd values', () => {
  it('reads the 00/01 flags', () => {
    expect(erdFlag('01')).toBe(true)
    expect(erdFlag('00')).toBe(false)
    expect(erdFlag(undefined)).toBeUndefined()
    expect(erdFlag('zz')).toBeUndefined()
  })

  it('turns the water temperature from °F into °C, and treats 0 as no reading', () => {
    // 0xB6 = 182 °F, seen mid-brew on a C7CDAASP3 (#152)
    expect(waterTempCelsius('B6')).toBe(83.3)
    expect(waterTempCelsius('00')).toBeUndefined()
    expect(waterTempCelsius('')).toBeUndefined()
  })

  it('starts a brew with the machine\'s own settings', () => {
    // idle 0x900B on a C7CDAASP3: strength 3, 195 °F, 4 cups (#152)
    expect(brewSettingsValue('03c304', undefined, undefined, undefined)).toBe('03C304')
    // without 0x900B, built from strength (0x9008), temperature (0x9001) and cups (0x9006)
    expect(brewSettingsValue(undefined, '03', 'C3', '04')).toBe('03C304')
    expect(brewSettingsValue(undefined, '03', undefined, '04')).toBeUndefined()
  })

  it('counts the energy of a Coffee Brewer like any coffee maker', () => {
    expect(ENERGY_MODELS_BY_APPLIANCE_TYPE['Coffee Brewer']).toEqual(['coffeeMaker'])
  })
})

describe('coffee brewer accessory', () => {
  const occupancy = { OCCUPANCY_DETECTED: 1, OCCUPANCY_NOT_DETECTED: 0 }
  const Characteristic = new Proxy({}, {
    get: (_target, prop) => prop === 'OccupancyDetected'
      ? occupancy
      : prop,
  }) as any

  function makeService() {
    const values = new Map<unknown, unknown>()
    const handlers = new Map<unknown, { get?: () => unknown, set?: (value: unknown) => unknown }>()
    const characteristic = (key: unknown) => ({
      value: values.get(key),
      onGet(handler: () => unknown) {
        handlers.set(key, {
          ...handlers.get(key),
          get: handler,
        })
        return this
      },
      onSet(handler: (value: unknown) => unknown) {
        handlers.set(key, {
          ...handlers.get(key),
          set: handler,
        })
        return this
      },
      updateValue(next: unknown) {
        values.set(key, next)
        return this
      },
    })
    return {
      values,
      handlers,
      getCharacteristic: (key: unknown) => characteristic(key),
      setCharacteristic(key: unknown, value: unknown) {
        values.set(key, value)
        return this
      },
      updateCharacteristic(key: unknown, value: unknown) {
        values.set(key, value)
        return this
      },
      setPrimaryService: vi.fn(),
      testCharacteristic: () => false,
      addOptionalCharacteristic: (key: unknown) => characteristic(key),
    }
  }

  function build(placeholders: string[] = []) {
    const services = new Map<string, ReturnType<typeof makeService>>()
    services.set('AccessoryInformation', makeService())
    for (const name of placeholders) {
      services.set(name, makeService())
    }
    const accessory = {
      UUID: 'coffee-uuid',
      displayName: 'Coffee Brewer',
      context: {
        device: { features: [] },
      },
      getService: (name: string) => services.get(name),
      addService(_type: unknown, name: string) {
        const service = makeService()
        services.set(name, service)
        return service
      },
      removeService: vi.fn((service: unknown) => {
        for (const [name, s] of services) {
          if (s === service) {
            services.delete(name)
          }
        }
      }),
    }
    const device = { applianceId: 'C1' } as any
    const platform = {
      api: {
        hap: { Characteristic, Service: Characteristic },
      },
      log: Object.assign(vi.fn(), {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        success: vi.fn(),
      }),
      config: {
        devices: [device],
      },
      Characteristic,
      Service: Characteristic,
    } as any
    const brewer = new SmartHQCoffeeMaker(platform, accessory as any, device)
    const erds: Record<string, string | undefined> = {}
    vi.spyOn(brewer, 'readErd').mockImplementation(async erd => erds[erd])
    const writeErd = vi.spyOn(brewer, 'writeErd').mockResolvedValue(undefined)
    return {
      brewer,
      services,
      accessory,
      erds,
      writeErd,
    }
  }

  it('starts a brew with the settings the machine reports', async () => {
    const { services, erds, writeErd } = build()
    erds['0x900b'] = '03C304'
    await services.get('Brew')!.handlers.get('On')!.set!(true)
    expect(writeErd).toHaveBeenCalledWith('0x900b', '03C304')
  })

  it('cancels the brew when the switch is turned off', async () => {
    const { services, writeErd } = build()
    await services.get('Brew')!.handlers.get('On')!.set!(false)
    expect(writeErd).toHaveBeenCalledWith('0x900c', true)
  })

  it('sends nothing when the brew settings cannot be read', async () => {
    const { services, writeErd } = build()
    await services.get('Brew')!.handlers.get('On')!.set!(true)
    expect(writeErd).not.toHaveBeenCalled()
  })

  it('reads the brewing state, carafe, water and temperature', async () => {
    const { services, erds } = build()
    Object.assign(erds, {
      '0x9000': '01',
      '0x9012': '01',
      '0x9013': '00',
      '0x9014': 'C3',
    })
    expect(await services.get('Brew')!.handlers.get('On')!.get!()).toBe(true)
    expect(await services.get('Carafe')!.handlers.get(occupancy)!.get!()).toBe(1)
    expect(await services.get('Out of Water')!.handlers.get(occupancy)!.get!()).toBe(0)
    expect(await services.get('Water Temperature')!.handlers.get('CurrentTemperature')!.get!()).toBe(90.6)
  })

  it('follows pushed updates during a brew', () => {
    const { brewer, services } = build()
    brewer.onErdUpdate('0x9000', '01')
    brewer.onErdUpdate('0x9012', '00')
    brewer.onErdUpdate('0x9013', '01')
    brewer.onErdUpdate('0x9014', 'B6')
    expect(services.get('Brew')!.values.get('On')).toBe(true)
    expect(services.get('Carafe')!.values.get(occupancy)).toBe(0)
    expect(services.get('Out of Water')!.values.get(occupancy)).toBe(1)
    expect(services.get('Water Temperature')!.values.get('CurrentTemperature')).toBe(83.3)
  })

  it('removes the old placeholder services that never read anything', () => {
    const { services } = build(['Coffee Maker', 'Water Level', 'Coffee Filter'])
    expect(services.has('Coffee Maker')).toBe(false)
    expect(services.has('Water Level')).toBe(false)
    expect(services.has('Coffee Filter')).toBe(false)
    expect(services.has('Brew')).toBe(true)
  })
})
