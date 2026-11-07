import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  airConditionerModel,
  cooktopWatts,
  DEFAULT_DRYER_PROFILE,
  DEFAULT_WASHER_PROFILE,
  dishwasherModel,
  dryerHeatShare,
  ENERGY_MODELS,
  ENERGY_MODELS_BY_APPLIANCE_TYPE,
  EnergyHistory,
  EnergyMeter,
  EnergyMonitor,
  EnergyStore,
  estimateDryerWatts,
  estimateWasherWatts,
  EVE_CONSUMPTION_UUID,
  EVE_TOTAL_CONSUMPTION_UUID,
  HISTORY_MAX_CYCLES,
  iceMakerModel,
  localDay,
  MATTER_ENERGY_INTERVAL_MS,
  MAX_INTEGRATION_GAP_MS,
  ovenModel,
  refrigeratorModel,
  removeEnergyServices,
  resolveEnergyProtocol,
  resolveProfile,
  sanitiseHistory,
  toMilliwattHours,
  toMilliwatts,
  washerDryerModel,
  washerModel,
  washTempHeaterShare,
  waterHeaterModel,
} from './index.js'

// gehome ErdMachineState / ErdLaundrySubCycle values
const RUN = 2
const PAUSE = 3
const END_OF_CYCLE = 4
const FILL = 1
const WASH = 3
const SPIN = 5
const DRYING = 128
const COOL_DOWN = 130

function lookup(erds: Record<string, string>) {
  return {
    erd: (e: string) => erds[e.toLowerCase()] ?? erds[e],
  }
}

// --- laundry ----------------------------------------------------------------

describe('estimateWasherWatts', () => {
  it('reports standby when the machine is not running', () => {
    expect(estimateWasherWatts({})).toBe(DEFAULT_WASHER_PROFILE.standbyWatts)
    expect(estimateWasherWatts({ machineState: 1 })).toBe(2)
    expect(estimateWasherWatts({ machineState: END_OF_CYCLE, subCycle: SPIN })).toBe(2)
    expect(estimateWasherWatts({ machineState: PAUSE, subCycle: WASH })).toBe(2)
  })

  it('a cold wash is mostly motor; a hot wash adds the heater', () => {
    expect(estimateWasherWatts({ machineState: RUN, subCycle: WASH, temperature: 0 })).toBe(152)
    expect(estimateWasherWatts({ machineState: RUN, subCycle: WASH, temperature: 21 })).toBe(1232)
    expect(estimateWasherWatts({ machineState: RUN, subCycle: WASH, temperature: 22 })).toBe(1952)
  })

  it('spin uses the spin wattage regardless of temperature', () => {
    expect(estimateWasherWatts({ machineState: RUN, subCycle: SPIN, temperature: 22 })).toBe(402)
  })

  it('a hot-fed top loader with no heater never heats', () => {
    const p = { ...DEFAULT_WASHER_PROFILE, heaterWatts: 0 }
    expect(estimateWasherWatts({ machineState: RUN, subCycle: WASH, temperature: 22 }, p)).toBe(152)
  })

  it('steam cycles add the steam generator', () => {
    expect(estimateWasherWatts({
      machineState: RUN,
      subCycle: WASH,
      cycle: 7,
      temperature: 0,
    })).toBe(1052)
  })

  it('heater share rises with the selected temperature', () => {
    expect(washTempHeaterShare(0)).toBe(0)
    expect(washTempHeaterShare(1)).toBeLessThan(washTempHeaterShare(2))
    expect(washTempHeaterShare(22)).toBe(1)
  })
})

describe('a whole 40 °C cotton wash', () => {
  it('lands near the WH9060P4 label figure of ~0.75 kWh per wash', () => {
    const phases: Array<[number, number]> = [
      [FILL, 10],
      [WASH, 60],
      [4, 25],
      [6, 5],
      [SPIN, 15],
    ]
    const m = new EnergyMeter(0, 0)
    let t = 0
    for (const [subCycle, minutes] of phases) {
      m.update(estimateWasherWatts({ machineState: RUN, subCycle, temperature: 20 }), t)
      t += minutes * 60_000
    }
    m.update(0, t)
    expect(m.totalKwh).toBeGreaterThan(0.6)
    expect(m.totalKwh).toBeLessThan(1)
  })
})

describe('estimateDryerWatts', () => {
  it('heats while drying and only tumbles during cool down', () => {
    expect(estimateDryerWatts({ machineState: RUN, subCycle: DRYING, temperature: 1 })).toBe(2602)
    expect(estimateDryerWatts({ machineState: RUN, subCycle: COOL_DOWN, temperature: 1 })).toBe(202)
    expect(estimateDryerWatts({ machineState: 1 })).toBe(DEFAULT_DRYER_PROFILE.standbyWatts)
  })

  it('prefers the newer temperature encoding', () => {
    expect(dryerHeatShare(5, 0)).toBe(1)
    expect(dryerHeatShare(undefined, 0)).toBe(0)
    expect(dryerHeatShare(undefined, undefined)).toBe(0.8)
  })
})

describe('washer/dryer combo', () => {
  it('uses washer phases below 128 and dryer phases from 128', () => {
    const wash = washerDryerModel.estimate(lookup({ '0x2000': '02', '0x2001': '03', '0x2016': '14' }), washerDryerModel.defaults)
    const dry = washerDryerModel.estimate(lookup({ '0x2000': '02', '0x2001': '80', '0x2050': '05' }), washerDryerModel.defaults)
    expect(wash).toEqual({ watts: 2 + 150 + 1500 * 0.3, active: true })
    expect(dry).toEqual({ watts: 2 + 150 + 900, active: true })
  })
})

// --- every other appliance --------------------------------------------------

describe('appliance models', () => {
  it('dishwasher heats in main wash, idles when not running', () => {
    const p = dishwasherModel.defaults
    expect(dishwasherModel.estimate(lookup({ '0x3001': '05', '0x300e': '03' }), p)).toEqual({ watts: 1 + 80 + 600, active: true })
    expect(dishwasherModel.estimate(lookup({ '0x3001': '05', '0x300e': '04' }), p).watts).toBe(1 + 480)
    expect(dishwasherModel.estimate(lookup({ '0x3001': '03', '0x300e': '03' }), p)).toEqual({ watts: 1, active: false }) // delay start
  })

  it('oven runs the element flat out preheating, then on a duty cycle', () => {
    const p = ovenModel.defaults
    // bake (01) at 350 °F (0x015E), cavity at 200 °F (0xC8) -> preheating
    const preheat = ovenModel.estimate(lookup({ '0x5101': '01', '0x5100': '01015E', '0x5109': '00C8' }), p)
    const holding = ovenModel.estimate(lookup({ '0x5101': '01', '0x5100': '01015E', '0x5109': '015E' }), p)
    expect(preheat).toEqual({ watts: 3 + 3500, active: true })
    expect(holding).toEqual({ watts: 3 + 1225, active: true })
    expect(ovenModel.estimate(lookup({ '0x5101': '00', '0x5201': 'CC' }), p)).toEqual({ watts: 3, active: false })
  })

  it('cooktop scales each lit burner by its power level', () => {
    // slot 1 on (0x23|0x40) at full 0x4B, others idle
    const status = `01${'634B'}${'0100'.repeat(5)}`
    expect(cooktopWatts(status, 2000)).toBe(2000)
    expect(cooktopWatts('00', 2000)).toBe(0)
  })

  it('refrigerator is always on, with turbo cool adding the boost', () => {
    const p = refrigeratorModel.defaults
    expect(refrigeratorModel.estimate(lookup({ '0x100f': '00', '0x100e': '00' }), p)).toEqual({ watts: 45, active: true })
    expect(refrigeratorModel.estimate(lookup({ '0x100f': '01', '0x100e': '00' }), p).watts).toBe(105)
  })

  it('air conditioner runs the compressor until the room reaches the set point', () => {
    const p = airConditionerModel.defaults
    const base = {
      '0x7a0f': '01',
      '0x7a01': '00',
      '0x7a00': '08',
      '0x7003': '48',
    } // on, cool, high fan, 72 °F
    expect(airConditionerModel.estimate(lookup({ ...base, '0x7a02': '50' }), p).watts).toBe(1 + 60 + 900) // 80 °F
    expect(airConditionerModel.estimate(lookup({ ...base, '0x7a02': '48' }), p).watts).toBe(1 + 60 + 270) // at 72 °F
    expect(airConditionerModel.estimate(lookup({ ...base, '0x7a01': '01' }), p).watts).toBe(61) // fan only
    expect(airConditionerModel.estimate(lookup({ '0x7a0f': '00' }), p)).toEqual({ watts: 1, active: false })
  })

  it('water heater heats only when the tank is well below its set point', () => {
    const p = waterHeaterModel.defaults
    // tenths of °F: 120 °F = 0x04B0, 110 °F = 0x044C
    expect(waterHeaterModel.estimate(lookup({ '0x4020': '01', '0x4026': '044C', '0x4024': '04B0' }), p)).toEqual({ watts: 553, active: true })
    expect(waterHeaterModel.estimate(lookup({ '0x4020': '01', '0x4026': '04B0', '0x4024': '04B0' }), p)).toEqual({ watts: 3, active: false })
    expect(waterHeaterModel.estimate(lookup({ '0x4020': '04', '0x4026': '044C', '0x4024': '04B0' }), p).active).toBe(false)
  })

  it('ice maker runs its compressor while making ice', () => {
    const p = iceMakerModel.defaults
    expect(iceMakerModel.estimate(lookup({ '0x9107': '01', '0x9100': '00' }), p).watts).toBe(137)
    expect(iceMakerModel.estimate(lookup({ '0x9107': '00' }), p)).toEqual({ watts: 2, active: false })
  })

  it('every model gives a finite, non-negative reading with no data at all', () => {
    for (const model of Object.values(ENERGY_MODELS)) {
      const r = model.estimate({
        erd: () => undefined,
      }, model.defaults)
      expect(Number.isFinite(r.watts)).toBe(true)
      expect(r.watts >= 0).toBe(true)
    }
  })

  it('model keys are unique (they name saved totals and Matter UUIDs)', () => {
    const keys = Object.values(ENERGY_MODELS).map(m => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('resolveProfile', () => {
  it('keeps defaults and applies valid overrides only', () => {
    const p = resolveProfile(DEFAULT_WASHER_PROFILE, { energyHeaterWatts: 2000, energyMotorWatts: -5, energySpinWatts: Number.NaN })
    expect(p).toEqual({ ...DEFAULT_WASHER_PROFILE, heaterWatts: 2000 })
  })
})

describe('energyMeter', () => {
  it('credits the previous wattage for the elapsed time', () => {
    const m = new EnergyMeter(0, 0)
    m.update(2000, 0)
    m.update(0, 30 * 60 * 1000)
    expect(m.totalKwh).toBeCloseTo(1, 6)
  })

  it('caps a single gap so a stalled clock cannot add a lump', () => {
    const m = new EnergyMeter(5, 0)
    m.update(1000, 0)
    m.update(1000, 10 * MAX_INTEGRATION_GAP_MS)
    expect(m.totalKwh).toBeCloseTo(6, 6)
  })
})

describe('energyStore', () => {
  it('survives a restart, unlike accessory.context which the platform rebuilds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smarthq-energy-'))
    const path = join(dir, 'smarthq-energy.json')
    try {
      const a = new EnergyStore(path)
      a.set('ABC:washer', 12.5)
      a.flush()
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ 'ABC:washer': 12.5 })
      expect(new EnergyStore(path).get('ABC:washer')).toBe(12.5)
      expect(new EnergyStore(path).get('other')).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// --- HomeKit wiring, against a minimal fake of the HAP surface used ----------

class FakeCharacteristic {
  static UUID = 'base'
  value: any = 0
  constructor(public displayName = '', public UUID = '', public props: any = {}) {}
  getDefaultValue() {
    return 0
  }

  onGet() {
    return this
  }

  onSet() {
    return this
  }
}
function ch(uuid: string) {
  return class extends FakeCharacteristic {
    static UUID = uuid
  }
}
const Characteristic: any = Object.assign(FakeCharacteristic, {
  On: ch('on'),
  OutletInUse: ch('inuse'),
  CurrentAmbientLightLevel: ch('lux'),
  Name: ch('name'),
  ConfiguredName: ch('cname'),
})

class FakeService {
  chars = new Map<string, FakeCharacteristic>()
  linked: FakeService[] = []
  primary = false
  constructor(public type: string, public name: string, public subtype: string) {}
  getCharacteristic(C: any) {
    if (!this.chars.has(C.UUID)) {
      this.chars.set(C.UUID, new C())
    }
    return this.chars.get(C.UUID)!
  }

  testCharacteristic(C: any) {
    return this.chars.has(C.UUID)
  }

  addCharacteristic(C: any) {
    return this.getCharacteristic(C)
  }

  addOptionalCharacteristic(C: any) {
    this.getCharacteristic(C)
  }

  setCharacteristic(C: any, v: any) {
    this.getCharacteristic(C).value = v
    return this
  }

  updateCharacteristic(C: any, v: any) {
    this.getCharacteristic(C).value = v
    return this
  }

  setPrimaryService(p: boolean) {
    this.primary = p
  }

  addLinkedService(s: FakeService) {
    this.linked.push(s)
  }
}
const Service: any = { Outlet: 'outlet', Switch: 'switch', LightSensor: 'lightsensor' }

function fakeAccessory() {
  const services: FakeService[] = []
  return {
    services,
    context: {
      device: {
        applianceId: 'ABC',
        brand: 'Fisher & Paykel',
        model: 'WH9060P4',
        firmware: '1.2',
      },
    } as any,
    getServiceById: (type: string, subtype: string) => services.find(s => s.type === type && s.subtype === subtype),
    addService: (type: string, name: string, subtype: string) => {
      const s = new FakeService(type, name, subtype)
      services.push(s)
      return s
    },
    removeService: (s: FakeService) => {
      services.splice(services.indexOf(s), 1)
    },
  }
}

const hap: any = {
  Characteristic,
  Service,
  Formats: { FLOAT: 'float' },
  Perms: { PAIRED_READ: 'pr', NOTIFY: 'ev' },
}

function makeMonitor(erds: Record<string, string>, device: any = {}, opts: { accessory?: any, matterApi?: any, model?: any, store?: EnergyStore, history?: EnergyHistory } = {}) {
  const accessory = opts.accessory ?? fakeAccessory()
  const store = opts.store ?? new EnergyStore()
  const monitor = new EnergyMonitor({
    hap,
    accessory,
    device: { showEnergy: true, ...device },
    applianceId: 'ABC',
    refreshRateSeconds: 360,
    readErd: async erd => erds[erd] ?? erds[erd.toLowerCase()],
    store,
    history: opts.history,
    name: 'Laundry Washer',
    infoLog: () => {},
    debugLog: () => {},
    warnLog: () => {},
    matterApi: opts.matterApi,
  }, opts.model ?? washerModel)
  return { monitor, accessory, store }
}

describe('energyMonitor over HAP', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('replaces the laundry running switch with an outlet carrying Eve watts and kWh', async () => {
    const accessory = fakeAccessory()
    accessory.addService('switch', 'Washer Running', 'WasherRunning')
    const { monitor } = makeMonitor({ '0x2000': '02', '0x2001': '03', '0x2016': '15' }, {}, { accessory })
    await vi.advanceTimersByTimeAsync(0)
    expect(accessory.services.find(s => s.type === 'switch')).toBeUndefined()
    const outlet = accessory.getServiceById('outlet', 'WasherRunning')!
    expect(outlet.chars.get('on')!.value).toBe(true)
    expect(outlet.chars.get(EVE_CONSUMPTION_UUID)!.value).toBe(1232)
    expect(outlet.chars.has(EVE_TOTAL_CONSUMPTION_UUID)).toBe(true)
    monitor.shutdown()
  })

  it('gives other appliances an "<Name> Energy" outlet of their own', async () => {
    const { monitor, accessory } = makeMonitor({ '0x3001': '05', '0x300e': '03' }, {}, { model: dishwasherModel })
    await vi.advanceTimersByTimeAsync(0)
    const outlet = accessory.getServiceById('outlet', 'DishwasherEnergy')!
    expect(outlet.chars.get('cname')!.value).toBe('Dishwasher Energy')
    expect(outlet.chars.get(EVE_CONSUMPTION_UUID)!.value).toBe(681)
    monitor.shutdown()
  })

  it('mirrors the watts as lux when asked, linked to the outlet', async () => {
    const { monitor, accessory } = makeMonitor({ '0x2000': '02', '0x2001': '05' }, { showEnergyInHome: true })
    await vi.advanceTimersByTimeAsync(0)
    const outlet = accessory.getServiceById('outlet', 'WasherRunning')!
    const sensor = accessory.getServiceById('lightsensor', 'WasherPower')!
    expect(sensor.chars.get('lux')!.value).toBe(402)
    expect(outlet.linked).toContain(sensor)
    monitor.shutdown()
  })

  it('reports a valid lux reading at 0 W (HomeKit minimum is 0.0001)', async () => {
    const { monitor, accessory } = makeMonitor({ '0x2000': '01' }, { showEnergyInHome: true, energyStandbyWatts: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(accessory.getServiceById('lightsensor', 'WasherPower')!.chars.get('lux')!.value).toBe(0.0001)
    monitor.shutdown()
  })

  it('reacts to pushes, accumulates energy and keeps the total in the store', async () => {
    const erds: Record<string, string> = { '0x2000': '01' }
    const store = new EnergyStore()
    const { monitor } = makeMonitor(erds, {}, { store })
    await vi.advanceTimersByTimeAsync(0)
    const push = (erd: string, value: string) => {
      erds[erd] = value // the platform caches a push before forwarding it
      monitor.onErdUpdate(erd, value)
    }
    push('0x2000', '02')
    push('0x2016', '16')
    push('0x2001', '03')
    expect(monitor.watts).toBe(1952)
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    expect(monitor.totalKwh).toBeCloseTo(0.976, 2)
    push('0x2000', '04')
    expect(monitor.watts).toBe(2)
    monitor.shutdown()
    expect(store.get('ABC:washer')).toBeCloseTo(0.976, 2)
  })

  it('restores the kWh total from the store', () => {
    const store = new EnergyStore()
    store.set('ABC:washer', 12.5)
    const { monitor } = makeMonitor({ '0x2000': '01' }, {}, { store })
    expect(monitor.totalKwh).toBe(12.5)
    monitor.shutdown()
  })

  it('removes its services when the option is switched off', () => {
    const accessory = fakeAccessory()
    accessory.addService('outlet', 'Washer Running', 'WasherRunning')
    accessory.addService('lightsensor', 'Washer Power', 'WasherPower')
    removeEnergyServices(accessory as any, hap, washerModel)
    expect(accessory.services).toHaveLength(0)
  })
})

// --- Matter ----------------------------------------------------------------

function fakeMatterApi(registerErrors: string[] = []) {
  const registered: any[] = []
  const updates: Array<{ cluster: string, attributes: any }> = []
  return {
    registered,
    updates,
    uuid: {
      generate: (s: string) => `uuid:${s}`,
    },
    deviceTypes: {
      OnOffOutlet: { name: 'OnOffPlugInUnit' },
    },
    registerPlatformAccessories: vi.fn(async (_plugin: string, _platform: string, accessories: any[]) => {
      const error = registerErrors.shift()
      if (error) {
        throw new Error(error)
      }
      registered.push(...accessories)
    }),
    updateAccessoryState: async (_uuid: string, cluster: string, attributes: any) => {
      updates.push({ cluster, attributes })
    },
    last(cluster: string) {
      return [...updates].reverse().find(u => u.cluster === cluster)?.attributes
    },
  }
}

describe('resolveEnergyProtocol', () => {
  it('defaults to HAP and accepts matter', () => {
    expect(resolveEnergyProtocol({})).toBe('hap')
    expect(resolveEnergyProtocol({ energyProtocol: 'matter' })).toBe('matter')
    expect(resolveEnergyProtocol({ energyProtocol: 'nonsense' })).toBe('hap')
  })

  it('converts to Matter units', () => {
    expect(toMilliwatts(1232)).toBe(1_232_000)
    expect(toMilliwattHours(0.75)).toBe(750_000)
  })
})

describe('energyMonitor over Matter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('publishes a Matter outlet with power and energy clusters and no HAP tile', async () => {
    const matter = fakeMatterApi()
    const accessory = fakeAccessory()
    accessory.addService('switch', 'Washer Running', 'WasherRunning')
    accessory.addService('outlet', 'Washer Running', 'WasherRunning')
    const { monitor } = makeMonitor({ '0x2000': '02', '0x2001': '03', '0x2016': '14' }, { energyProtocol: 'matter' }, { accessory, matterApi: matter })
    await vi.advanceTimersByTimeAsync(0)
    expect(accessory.services).toHaveLength(0)
    const outlet = matter.registered[0]
    expect(outlet.deviceType).toBe(matter.deviceTypes.OnOffOutlet)
    expect(outlet.displayName).toBe('Washer Running')
    expect(outlet.UUID).toBe('uuid:ABC-washer-energy')
    expect(outlet.manufacturer).toBe('Fisher & Paykel')
    expect('cumulativeEnergyImported' in outlet.clusters.electricalEnergyMeasurement).toBe(true)
    expect(matter.last('onOff')).toEqual({ onOff: true })
    expect(matter.last('electricalPowerMeasurement')).toEqual({ activePower: 692_000 })
    monitor.shutdown()
  })

  it('publishes always-on appliances as an outlet that stays On', async () => {
    const matter = fakeMatterApi()
    const { monitor } = makeMonitor({ '0x100f': '00' }, { energyProtocol: 'matter' }, { matterApi: matter, model: refrigeratorModel })
    await vi.advanceTimersByTimeAsync(0)
    const outlet = matter.registered[0]
    // an outlet, not an ElectricalSensor: outlets are what Apple Home's energy view reads
    expect(outlet.deviceType).toBe(matter.deviceTypes.OnOffOutlet)
    expect(outlet.displayName).toBe('Refrigerator Energy')
    expect(outlet.clusters.onOff).toEqual({ onOff: true })
    expect(matter.last('onOff')).toEqual({ onOff: true })
    expect(matter.last('electricalPowerMeasurement')).toEqual({ activePower: 45_000 })
    monitor.shutdown()
  })

  it('sends power on every change but energy at most once a minute', async () => {
    const matter = fakeMatterApi()
    const erds: Record<string, string> = { '0x2000': '02', '0x2001': '03', '0x2016': '16' }
    const { monitor } = makeMonitor(erds, { energyProtocol: 'matter' }, { matterApi: matter })
    await vi.advanceTimersByTimeAsync(0)
    const energyUpdates = () => matter.updates.filter(u => u.cluster === 'electricalEnergyMeasurement').length
    const before = energyUpdates()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const sent = energyUpdates() - before
    expect(sent).toBeGreaterThan(5)
    expect(sent).toBeLessThan(10 * 60_000 / MATTER_ENERGY_INTERVAL_MS + 1)
    erds['0x2001'] = '05'
    monitor.onErdUpdate('0x2001', '05')
    expect(matter.last('electricalPowerMeasurement')).toEqual({ activePower: 402_000 })
    monitor.shutdown()
  })

  it('snaps the outlet back when someone taps it', async () => {
    const matter = fakeMatterApi()
    const { monitor } = makeMonitor({ '0x2000': '01' }, { energyProtocol: 'matter' }, { matterApi: matter })
    await vi.advanceTimersByTimeAsync(0)
    matter.updates.length = 0
    await matter.registered[0].handlers.onOff.on()
    await vi.advanceTimersByTimeAsync(1500)
    expect(matter.last('onOff')).toEqual({ onOff: false })
    monitor.shutdown()
  })

  it('retries while the bridge Matter server is still starting', async () => {
    const matter = fakeMatterApi(['Cannot register Matter accessories yet — the Matter server for this bridge is still starting.'])
    const { monitor, accessory } = makeMonitor({ '0x2000': '01' }, { energyProtocol: 'matter' }, { matterApi: matter })
    await vi.advanceTimersByTimeAsync(0)
    expect(matter.registered).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(matter.registered).toHaveLength(1)
    expect(monitor.protocol).toBe('matter')
    expect(accessory.services).toHaveLength(0)
    monitor.shutdown()
  })

  it('falls back to HAP when Matter is not enabled, or missing', async () => {
    const matter = fakeMatterApi(['Cannot register: Matter is not enabled for this bridge.'])
    const a = makeMonitor({ '0x2000': '02', '0x2001': '05' }, { energyProtocol: 'matter' }, { matterApi: matter })
    const b = makeMonitor({ '0x2000': '01' }, { energyProtocol: 'matter' })
    await vi.advanceTimersByTimeAsync(0)
    expect(a.monitor.protocol).toBe('hap')
    expect(a.accessory.getServiceById('outlet', 'WasherRunning')!.chars.get(EVE_CONSUMPTION_UUID)!.value).toBe(402)
    expect(b.monitor.protocol).toBe('hap')
    expect(b.accessory.getServiceById('outlet', 'WasherRunning')).toBeDefined()
    a.monitor.shutdown()
    b.monitor.shutdown()
  })
})

// --- dashboard: descriptions, history, status --------------------------------

describe('model descriptions for the dashboard', () => {
  const ctx = (erds: Record<string, string>) => ({
    erd: (e: string) => erds[e.toLowerCase()],
  })

  it('describes a running wash by phase and temperature, and names the programme', () => {
    const c = ctx({
      '0x2000': '02',
      '0x2001': '03',
      '0x2016': '14',
      '0x200a': '1c',
    })
    expect(washerModel.describe!(c)).toBe('Wash, warm')
    expect(washerModel.cycleName!(c)).toBe('Normal')
  })

  it('describes an idle or finished washer by machine state', () => {
    expect(washerModel.describe!(ctx({ '0x2000': '04' }))).toBe('Cycle finished')
    expect(washerModel.describe!(ctx({}))).toBeUndefined()
  })

  it('describes the dryer heat setting and the dishwasher phase', () => {
    expect(ENERGY_MODELS.dryer.describe!(ctx({ '0x2000': '02', '0x2001': '80', '0x2050': '05' }))).toBe('Drying, high heat')
    expect(dishwasherModel.describe!(ctx({ '0x3001': '05', '0x300e': '03' }))).toBe('Main wash')
    expect(dishwasherModel.describe!(ctx({ '0x3001': '02' }))).toBe('Standby')
  })

  it('describes the oven, air conditioner and water heater', () => {
    expect(ovenModel.describe!(ctx({ '0x5101': '01', '0x5100': '01015e', '0x5109': '0064' }))).toBe('Oven preheating at 350 °F')
    expect(airConditionerModel.describe!(ctx({ '0x7a0f': '01', '0x7a01': '00', '0x7003': '48' }))).toBe('Cooling to 72 °F')
    expect(waterHeaterModel.describe!(ctx({ '0x4020': '04' }))).toBe('Vacation')
  })

  it('has a description for every model', () => {
    for (const model of Object.values(ENERGY_MODELS)) {
      expect(typeof model.describe).toBe('function')
    }
  })
})

describe('energyHistory', () => {
  it('adds energy to the local day and ignores nonsense amounts', () => {
    const h = new EnergyHistory()
    const t = new Date(2026, 10, 8, 9, 30).getTime()
    h.addEnergy('ABC:washer', 0.5, t)
    h.addEnergy('ABC:washer', 0.25, t + 60_000)
    h.addEnergy('ABC:washer', -1, t)
    h.addEnergy('ABC:washer', Number.NaN, t)
    expect(localDay(t)).toBe('2026-11-08')
    expect(h.snapshot().days['ABC:washer']).toEqual({ '2026-11-08': 0.75 })
  })

  it('keeps only the newest cycles', () => {
    const h = new EnergyHistory()
    for (let i = 0; i < HISTORY_MAX_CYCLES + 5; i++) {
      h.addCycle({
        key: 'k',
        name: 'n',
        start: i,
        end: i + 1,
        kwh: 0.1,
        peakWatts: 10,
      })
    }
    const cycles = h.snapshot().cycles
    expect(cycles).toHaveLength(HISTORY_MAX_CYCLES)
    expect(cycles[0].start).toBe(5)
  })

  it('survives a restart through its file, and drops malformed entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smarthq-history-'))
    try {
      const path = join(dir, 'smarthq-energy-history.json')
      const h = new EnergyHistory(path)
      h.addEnergy('ABC:washer', 0.8, new Date(2026, 10, 8, 12).getTime())
      h.addCycle({
        key: 'ABC:washer',
        name: 'Washer',
        cycle: 'Cottons',
        start: 1,
        end: 2,
        kwh: 0.8,
        peakWatts: 700,
      })
      h.flush()
      const again = new EnergyHistory(path)
      expect(again.snapshot().days['ABC:washer']['2026-11-08']).toBe(0.8)
      expect(again.snapshot().cycles[0].cycle).toBe('Cottons')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const clean = sanitiseHistory({
      days: {
        k: { 'not-a-day': 1, '2026-01-01': -3, '2026-01-02': 2 },
      },
      cycles: [
        { key: 'k' },
        null,
      ],
    })
    expect(clean.days).toEqual({
      k: { '2026-01-02': 2 },
    })
    expect(clean.cycles).toHaveLength(0)
  })
})

describe('energyMonitor dashboard data', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('records each finished cycle with its programme, energy and peak, and fills the day', async () => {
    const history = new EnergyHistory()
    const erds: Record<string, string> = { '0x2000': '01' }
    const { monitor } = makeMonitor(erds, {}, { history })
    await vi.advanceTimersByTimeAsync(0)
    const push = (erd: string, value: string) => {
      erds[erd] = value
      monitor.onErdUpdate(erd, value)
    }
    push('0x2000', '02')
    push('0x200a', '80') // Cottons
    push('0x2016', '14') // warm
    push('0x2001', '03') // wash
    await vi.advanceTimersByTimeAsync(60 * 60_000) // an hour at 692 W
    const during = monitor.status()
    expect(during.cycle?.name).toBe('Cottons')
    expect(during.description).toBe('Wash, warm')
    push('0x2000', '04')

    const { cycles, days } = history.snapshot()
    expect(cycles).toHaveLength(1)
    expect(cycles[0]).toMatchObject({
      key: 'ABC:washer',
      name: 'Laundry Washer',
      cycle: 'Cottons',
      peakWatts: 692,
    })
    expect(cycles[0].kwh).toBeCloseTo(0.692, 2)
    const dayTotal = Object.values(days['ABC:washer']).reduce((a, b) => a + b, 0)
    expect(dayTotal).toBeCloseTo(monitor.totalKwh, 6)
    expect(monitor.status().cycle).toBeUndefined()
    monitor.shutdown()
  })

  it('reports what the dashboard and diagnostics need', async () => {
    const { monitor } = makeMonitor({ '0x2000': '02', '0x2001': '05', '0x7010': 'abcd' }, { energyProtocol: 'matter', energyHeaterWatts: 1500 })
    await vi.advanceTimersByTimeAsync(0)
    const s = monitor.status()
    expect(s).toMatchObject({
      key: 'ABC:washer',
      name: 'Laundry Washer',
      tileName: 'Washer Running',
      protocolWanted: 'matter',
      protocol: 'hap', // no Matter API in this test, so it fell back
      watts: 402,
      active: true,
      fixed: false,
    })
    expect(s.fallbackReason).toBe('Homebridge has no Matter API')
    expect(s.profile.heaterWatts).toBe(1500)
    expect(s.defaults.heaterWatts).toBe(1800)
    expect(s.erds['0x2001']).toBe('05')
    expect(s.rawPowerErds['0x7010']).toBe('abcd')
    expect(typeof s.lastValueAt).toBe('number')
    expect(JSON.parse(JSON.stringify(s))).toEqual(s) // survives the status file
    monitor.shutdown()
  })
})

describe('appliance type map for the settings page', () => {
  it('covers every appliance type the platform discovers, with real models', () => {
    const platform = readFileSync(new URL('../../platform.ts', import.meta.url), 'utf8')
    const switchBody = platform.slice(platform.indexOf('switch (device.type) {'), platform.indexOf('default:', platform.indexOf('switch (device.type) {')))
    const types = [
      ...switchBody.matchAll(/case '([^']+)':/g),
    ].map(m => m[1])
    expect(types.length).toBeGreaterThan(20)
    for (const type of types) {
      expect(ENERGY_MODELS_BY_APPLIANCE_TYPE[type]?.length ?? 0).toBeGreaterThan(0)
    }
    for (const keys of Object.values(ENERGY_MODELS_BY_APPLIANCE_TYPE)) {
      for (const key of keys) {
        expect(ENERGY_MODELS[key].key).toBe(key)
      }
    }
  })
})
