import { describe, expect, it, vi } from 'vitest'

import { decideKeurigCapability, hotWaterOnSetTemp, parseHotWaterStatus, SmartHQKeurig } from './keurig.js'

describe('parseHotWaterStatus', () => {
  it('returns safe defaults for undefined', () => {
    const r = parseHotWaterStatus(undefined)
    expect(r.status).toBe('NA')
    expect(r.timeUntilReadyMinutes).toBeNull()
    expect(r.currentTempF).toBeNull()
    expect(r.tankFull).toBeNull()
    expect(r.brewModulePresent).toBeNull()
    expect(r.podStatus).toBe('NA')
    expect(r.faulted).toBe(false)
  })

  it('returns safe defaults for empty string', () => {
    expect(parseHotWaterStatus('').status).toBe('NA')
  })

  it('returns safe defaults for short input', () => {
    expect(parseHotWaterStatus('ab').status).toBe('NA')
  })

  it('returns safe defaults for non-hex garbage', () => {
    expect(parseHotWaterStatus('zzzzzzzzzzzzzz').status).toBe('NA')
  })

  it('parses a fully-populated READY frame', () => {
    // status=02 (READY), time=0000 (0 min), temp=BE (190°F),
    // tank=01 (full), module=01 (present), pod=01 (READY)
    const r = parseHotWaterStatus('020000BE010101')
    expect(r.status).toBe('READY')
    expect(r.timeUntilReadyMinutes).toBe(0)
    expect(r.currentTempF).toBe(190)
    expect(r.tankFull).toBe(true)
    expect(r.brewModulePresent).toBe(true)
    expect(r.podStatus).toBe('READY')
    expect(r.faulted).toBe(false)
  })

  it('parses a HEATING frame with time-to-ready and a REPLACE pod', () => {
    // status=01 (HEATING), time=000A (10 min), temp=64 (100°F),
    // tank=01, module=01, pod=00 (REPLACE)
    const r = parseHotWaterStatus('01000A64010100')
    expect(r.status).toBe('HEATING')
    expect(r.timeUntilReadyMinutes).toBe(10)
    expect(r.currentTempF).toBe(100)
    expect(r.podStatus).toBe('REPLACE')
    expect(r.faulted).toBe(false)
  })

  it('marks fault states', () => {
    expect(parseHotWaterStatus('FD0000000F0101').faulted).toBe(true)
    expect(parseHotWaterStatus('FE0000000F0101').faulted).toBe(true)
  })

  it('strips an optional 0x prefix', () => {
    expect(parseHotWaterStatus('0x020000BE010101').status).toBe('READY')
  })

  it('accepts lowercase hex', () => {
    const r = parseHotWaterStatus('020000be010101')
    expect(r.status).toBe('READY')
    expect(r.currentTempF).toBe(190)
  })

  it('ignores trailing extra bytes beyond position 14', () => {
    const r = parseHotWaterStatus('020000BE010101FFFF')
    expect(r.status).toBe('READY')
    expect(r.currentTempF).toBe(190)
  })

  it('returns NA / null when tank/module/pod bytes are FF', () => {
    // NOT_HEATING, time=0000, temp=46 (70°F), tank=FF, module=FF, pod=FF
    const r = parseHotWaterStatus('00000046FFFFFF')
    expect(r.status).toBe('NOT_HEATING')
    expect(r.tankFull).toBeNull()
    expect(r.brewModulePresent).toBeNull()
    expect(r.podStatus).toBe('NA')
  })
})

describe('decideKeurigCapability', () => {
  const readyStatus = parseHotWaterStatus('020000BE010101')
  const idleDispenserStatus = parseHotWaterStatus('00000046FFFFFF')
  // Observed live on a PYE22PYNHFS: brew_module reports 0x03 (outside
  // gehome's documented PRESENT/NOT_PRESENT/NA enum).
  const pye22ObservedStatus = parseHotWaterStatus('00000056010301')
  const naStatus = parseHotWaterStatus(undefined)

  it('config override true wins regardless of status', () => {
    expect(decideKeurigCapability(true, naStatus)).toBe(true)
    expect(decideKeurigCapability(true, idleDispenserStatus)).toBe(true)
  })

  it('config override false wins regardless of status', () => {
    expect(decideKeurigCapability(false, readyStatus)).toBe(false)
  })

  it('auto-detects true whenever HOT_WATER_STATUS reports any non-NA status', () => {
    expect(decideKeurigCapability(undefined, readyStatus)).toBe(true)
    expect(decideKeurigCapability(undefined, idleDispenserStatus)).toBe(true)
    expect(decideKeurigCapability(undefined, pye22ObservedStatus)).toBe(true)
  })

  it('auto-detects false only on a completely NA frame (no hot-water dispenser)', () => {
    expect(decideKeurigCapability(undefined, naStatus)).toBe(false)
  })
})

describe('hotWaterOnSetTemp', () => {
  it('uses 190 °F (BE) on Keurig models that report a brew module', () => {
    expect(hotWaterOnSetTemp('020000BE010301')).toBe('BE')
    expect(hotWaterOnSetTemp('000000460101FF')).toBe('BE')
  })

  it('uses 185 °F (B9) on dispensers with no brew module (byte 6 = FF)', () => {
    expect(hotWaterOnSetTemp('00000046FFFFFF')).toBe('B9')
    expect(hotWaterOnSetTemp('0x0000004601ffff')).toBe('B9')
  })

  it('uses the configured temperature when one is set', () => {
    expect(hotWaterOnSetTemp('00000046FFFFFF', 170)).toBe('AA')
    expect(hotWaterOnSetTemp('020000BE010301', 175)).toBe('AF')
    expect(hotWaterOnSetTemp(undefined, 185)).toBe('B9')
  })

  it('ignores a configured temperature that is not a sensible °F value', () => {
    expect(hotWaterOnSetTemp('00000046FFFFFF', 0)).toBe('B9')
    expect(hotWaterOnSetTemp('00000046FFFFFF', 172.5)).toBe('B9')
    expect(hotWaterOnSetTemp('00000046FFFFFF', 400)).toBe('B9')
  })

  it('keeps the 190 °F default when status is missing or malformed', () => {
    expect(hotWaterOnSetTemp(undefined)).toBe('BE')
    expect(hotWaterOnSetTemp('')).toBe('BE')
    expect(hotWaterOnSetTemp('0000')).toBe('BE')
  })
})

describe('keurig live updates', () => {
  const occupancy = { OCCUPANCY_DETECTED: 1, OCCUPANCY_NOT_DETECTED: 0 }
  const Characteristic = new Proxy({}, {
    get: (_target, prop) => prop === 'OccupancyDetected'
      ? occupancy
      : prop,
  }) as any

  function makeService() {
    const values = new Map<unknown, unknown>()
    const characteristic = (key: unknown) => ({
      onGet() {
        return this
      },
      onSet() {
        return this
      },
      updateValue(next: unknown) {
        values.set(key, next)
        return this
      },
    })
    return {
      values,
      getCharacteristic: (key: unknown) => characteristic(key),
      setCharacteristic(key: unknown, value: unknown) {
        values.set(key, value)
        return this
      },
      updateCharacteristic(key: unknown, value: unknown) {
        values.set(key, value)
        return this
      },
      testCharacteristic: () => false,
      addOptionalCharacteristic: (key: unknown) => characteristic(key),
    }
  }

  function build() {
    const services = new Map<string, ReturnType<typeof makeService>>()
    services.set('AccessoryInformation', makeService())
    const accessory = {
      UUID: 'keurig-uuid',
      displayName: 'Keurig',
      context: {
        device: { features: [] },
      },
      getService: (name: string) => services.get(name),
      addService(_type: unknown, name: string) {
        const service = makeService()
        services.set(name, service)
        return service
      },
      removeService: vi.fn(),
    }
    const device = { applianceId: 'A1' } as any
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
    const keurig = new SmartHQKeurig(platform, accessory as any, device)
    return { keurig, services }
  }

  it('marks Hot Water Ready as soon as the fridge pushes a READY status', () => {
    const { keurig, services } = build()
    keurig.onErdUpdate('0x1010', '020000BEFFFFFF')
    expect(services.get('Hot Water Ready')!.values.get(occupancy)).toBe(1)

    keurig.onErdUpdate('0x1010', '01000AA0FFFFFF')
    expect(services.get('Hot Water Ready')!.values.get(occupancy)).toBe(0)
  })

  it('follows the dispensing flag', () => {
    const { keurig, services } = build()
    keurig.onErdUpdate('0x1018', '01')
    expect(services.get('Hot Water Dispensing')!.values.get(occupancy)).toBe(1)
    keurig.onErdUpdate('0x1018', '00')
    expect(services.get('Hot Water Dispensing')!.values.get(occupancy)).toBe(0)
  })

  it('checks the hot water every 15 s while the switch is on, and stops when it goes off', async () => {
    vi.useFakeTimers()
    try {
      const { keurig, services } = build()
      const fresh: Record<string, string> = { '0x1010': '01000AA0FFFFFF', '0x1011': 'AA' }
      const readErdFresh = vi.spyOn(keurig, 'readErdFresh').mockImplementation(async erd => fresh[erd])

      keurig.onErdUpdate('0x1011', 'AA')
      await vi.advanceTimersByTimeAsync(15_000)
      expect(readErdFresh).toHaveBeenCalledWith('0x1010')
      expect(services.get('Hot Water Ready')!.values.get(occupancy)).toBe(0)

      // the push for READY never arrives; the check finds it
      fresh['0x1010'] = '020000B601FFFF'
      await vi.advanceTimersByTimeAsync(15_000)
      expect(services.get('Hot Water Ready')!.values.get(occupancy)).toBe(1)

      // the fridge turns the heater off; the check sees it and stops
      fresh['0x1011'] = '00'
      await vi.advanceTimersByTimeAsync(15_000)
      expect(services.get('K-Cup Hot Water')!.values.get('On')).toBe(false)
      const calls = readErdFresh.mock.calls.length
      await vi.advanceTimersByTimeAsync(60_000)
      expect(readErdFresh.mock.calls.length).toBe(calls)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops checking on shutdown', async () => {
    vi.useFakeTimers()
    try {
      const { keurig } = build()
      const readErdFresh = vi.spyOn(keurig, 'readErdFresh').mockResolvedValue(undefined)
      keurig.onErdUpdate('0x1011', 'AA')
      keurig.shutdown()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(readErdFresh).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the switch in step when the set temperature changes elsewhere', () => {
    const { keurig, services } = build()
    keurig.onErdUpdate('0x1011', 'AA')
    expect(services.get('K-Cup Hot Water')!.values.get('On')).toBe(true)
    keurig.onErdUpdate('0x1011', '00')
    expect(services.get('K-Cup Hot Water')!.values.get('On')).toBe(false)
  })
})
