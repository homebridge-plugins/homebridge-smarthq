/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * energy/models.ts: per-appliance power ESTIMATES.
 *
 * SmartHQ reports no power readings for any appliance, so each model works out
 * an estimated draw in watts from what the appliance does report: whether it is
 * running, the phase of its cycle, its mode or setting, and (where available)
 * how far it is from its set temperature. Models are pure functions of the ERD
 * values, so they are cheap to run and easy to test.
 *
 * Every model is built from the same four wattages, which owners can override
 * per device (energyStandbyWatts / energyMotorWatts / energySpinWatts /
 * energyHeaterWatts). What each means is documented on the model.
 *
 * Appliances whose class does not read any state yet (coffee maker, microwave,
 * Advantium, beverage centre, water softener) get a constant average, flagged
 * `fixed`, until their state is decoded.
 */
import { ERD_TYPES } from '../../settings.js'
import { combinationCycleName, combinationSubCycleName } from '../laundryNames.js'

/** The wattages an estimate is built from; all user-overridable. */
export interface EnergyProfile {
  /** Base draw: controls, display, Wi-Fi - or the average draw of an always-on appliance. */
  standbyWatts: number
  /** Motor, pump, fan or compressor boost, depending on the appliance. */
  motorWatts: number
  /** Washer high-speed spin. Unused elsewhere. */
  spinWatts: number
  /** The main load at full output: heating element, water heater, compressor. */
  heaterWatts: number
}

export interface EnergyReading {
  watts: number
  /** Whether the appliance is doing something (shown as On on the tile). */
  active: boolean
}

/** Reads the latest value of an ERD (live push or last poll). */
export type ErdLookup = (erd: string) => string | undefined

export interface EnergyContext {
  erd: ErdLookup
  /** For appliances not driven by ERDs (the v2 smoker), whether it is active. */
  externalActive?: boolean
}

export interface EnergyModel {
  /** Stable id: part of the saved-total key and the Matter UUID. Never rename. */
  key: string
  /** Name prefix in HomeKit, e.g. "Washer". */
  label: string
  /** HAP outlet name. Defaults to `${label} Energy`. */
  tileName?: string
  /** HAP outlet subtype. Defaults to `${label}Energy` (spaces removed). */
  subtype?: string
  /** A plain HAP Switch subtype the energy outlet replaces (the laundry running switch). */
  replacesSwitch?: string
  /** ERDs the estimate reads; refreshed on the poll and watched on pushes. */
  erds: string[]
  defaults: EnergyProfile
  /**
   * Continuous loads with no on/off of their own (fridge, filter): the tile
   * always shows On, over HAP and Matter alike, and no "finished" is logged.
   */
  alwaysOn?: boolean
  /** The estimate is a constant: the appliance class reads no usable state yet. */
  fixed?: boolean
  estimate: (ctx: EnergyContext, p: EnergyProfile) => EnergyReading
  /** What the appliance is doing right now, for the dashboard (e.g. "Wash, 40 °C"). */
  describe?: (ctx: EnergyContext) => string | undefined
  /** The programme running, recorded with each finished cycle (e.g. "Cottons"). */
  cycleName?: (ctx: EnergyContext) => string | undefined
}

// --- helpers ---------------------------------------------------------------

function hex(v: string | undefined): number | undefined {
  if (v === undefined || v === '') {
    return undefined
  }
  const n = Number.parseInt(v, 16)
  return Number.isNaN(n)
    ? undefined
    : n
}
/** First byte of a multi-byte value. */
const byte0 = (v: string | undefined): number | undefined => hex(v?.replace(/^0x/i, '').slice(0, 2))
const round1 = (n: number): number => Math.round(n * 10) / 10
function reading(watts: number, active: boolean): EnergyReading {
  return {
    watts: round1(Math.max(watts, 0)),
    active,
  }
}
const fToC = (f: number): number => ((f - 32) * 5) / 9

export function resolveProfile(defaults: EnergyProfile, device: Record<string, unknown>): EnergyProfile {
  const pick = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : fallback
  return {
    standbyWatts: pick(device.energyStandbyWatts, defaults.standbyWatts),
    motorWatts: pick(device.energyMotorWatts, defaults.motorWatts),
    spinWatts: pick(device.energySpinWatts, defaults.spinWatts),
    heaterWatts: pick(device.energyHeaterWatts, defaults.heaterWatts),
  }
}

// --- laundry ----------------------------------------------------------------

/** A snapshot of the laundry ERDs, decoded. */
export interface LaundrySnapshot {
  machineState?: number
  subCycle?: number
  cycle?: number
  /** Washer: LAUNDRY_WASHER_WASHTEMP_LEVEL raw value. Dryer: decoded 0-1 heat share. */
  temperature?: number
}

// gehome ErdMachineState
const LAUNDRY_RUNNING = new Set([2, 8, 10]) // run, drain timeout, bulk flush
const LAUNDRY_ENGAGED = new Set([2, 3, 5, 6, 7, 8, 10]) // as the running tile has always shown (#60)
const LAUNDRY_PAUSED = new Set([3, 7])
const WASHER_STEAM_CYCLES = new Set([7, 24]) // Steam Refresh, Casuals With Steam

/**
 * Washers default to a cold-feed front loader that heats its own water, such
 * as the Fisher & Paykel WH9060P4 (2000 W max on its rating label, around
 * 1800 W of that being the heater). Hot-fed top loaders: heater 0.
 */
export const DEFAULT_WASHER_PROFILE: EnergyProfile = {
  standbyWatts: 2,
  motorWatts: 150,
  spinWatts: 400,
  heaterWatts: 1800,
}
/** 10 A vented / condenser dryer. Heat pump dryers: heater ~700. Gas: ~0. */
export const DEFAULT_DRYER_PROFILE: EnergyProfile = {
  standbyWatts: 2,
  motorWatts: 200,
  spinWatts: 0,
  heaterWatts: 2400,
}

/**
 * Share of the washer heater's rated output averaged over the wash phase, from
 * gehome's ErdWashTempLevel. Calibrated so a 40 °C cotton wash on a WH9060P4
 * comes to about 0.8 kWh, in line with its label (275 kWh/year, ~0.75 kWh/wash).
 */
export function washTempHeaterShare(raw: number | undefined): number {
  switch (raw) {
    case 0:
    case 16: // tap cold
      return 0
    case 1:
    case 17: // cold (~20 °C)
      return 0.07
    case 18:
    case 19: // cool, colours (~30 °C)
      return 0.2
    case 2:
    case 20: // warm (~40 °C)
      return 0.3
    case 3:
    case 21: // hot (~60 °C)
      return 0.6
    case 4:
    case 22: // extra hot / sanitise
      return 1
    default: // unknown - assume a typical 30 °C wash
      return 0.2
  }
}

/**
 * Dryer heat setting to a 0-1 share of heater output. Prefers the newer
 * LAUNDRY_DRYER_TEMPERATURENEW_OPTION (1 no heat ... 5 high), falling back to
 * LAUNDRY_DRYER_TEMPERATURE_OPTION (0 no heat ... 4 high).
 */
export function dryerHeatShare(newOption: number | undefined, oldOption: number | undefined): number {
  const fromNew: Record<number, number> = { 1: 0, 2: 0.4, 3: 0.6, 4: 0.8, 5: 1 }
  const fromOld: Record<number, number> = { 0: 0, 1: 0.4, 2: 0.6, 3: 0.8, 4: 1 }
  if (newOption !== undefined && newOption in fromNew) {
    return fromNew[newOption]
  }
  if (oldOption !== undefined && oldOption in fromOld) {
    return fromOld[oldOption]
  }
  return 0.8 // unknown - assume medium
}

export function estimateWasherWatts(s: LaundrySnapshot, p: EnergyProfile = DEFAULT_WASHER_PROFILE): number {
  if (s.machineState === undefined || LAUNDRY_PAUSED.has(s.machineState) || !LAUNDRY_RUNNING.has(s.machineState)) {
    return round1(p.standbyWatts) // idle, standby, paused, end of cycle, delayed start
  }
  const heat = p.heaterWatts * washTempHeaterShare(s.temperature)
  const steam = s.cycle !== undefined && WASHER_STEAM_CYCLES.has(s.cycle)
    ? p.heaterWatts * 0.5
    : 0
  let phase: number
  switch (s.subCycle) {
    case 1: // fill: valves, plus the heater starting once the element is covered
      phase = 15 + heat * 0.3
      break
    case 2: // soak: occasional turns
      phase = p.motorWatts * 0.15
      break
    case 3: // wash: tumbling while heating
      phase = p.motorWatts + heat
      break
    case 4:
    case 8: // rinse, extra rinse
      phase = p.motorWatts * 0.75
      break
    case 5:
    case 7: // spin, extra spin
      phase = p.spinWatts
      break
    case 6: // drain pump
      phase = 60
      break
    case 9:
    case 10: // tumble, load size detection
      phase = p.motorWatts * 0.5
      break
    default: // running, phase not reported
      phase = p.motorWatts * 0.5 + heat * 0.5
  }
  return round1(p.standbyWatts + phase + steam)
}

/** temperature is a 0-1 heat share (see dryerHeatShare). */
export function estimateDryerWatts(s: LaundrySnapshot, p: EnergyProfile = DEFAULT_DRYER_PROFILE): number {
  if (s.machineState === undefined || !LAUNDRY_RUNNING.has(s.machineState)) {
    return round1(p.standbyWatts)
  }
  const heatShare = s.temperature ?? 0.8
  let phase: number
  switch (s.subCycle) {
    case 128:
    case 132: // drying, damp
      phase = p.motorWatts + p.heaterWatts * heatShare
      break
    case 129: // mist steam
      phase = p.motorWatts + p.heaterWatts * 0.25
      break
    case 130:
    case 131:
    case 133: // cool down, extended tumble, air fluff
      phase = p.motorWatts
      break
    default: // running, phase not reported
      phase = p.motorWatts + p.heaterWatts * heatShare * 0.75
  }
  return round1(p.standbyWatts + phase)
}

const LAUNDRY_ERDS = [ERD_TYPES.LAUNDRY_MACHINE_STATE, ERD_TYPES.LAUNDRY_SUB_CYCLE, ERD_TYPES.LAUNDRY_CYCLE]
function laundrySnapshot(erd: ErdLookup): LaundrySnapshot {
  return {
    machineState: hex(erd(ERD_TYPES.LAUNDRY_MACHINE_STATE)),
    subCycle: hex(erd(ERD_TYPES.LAUNDRY_SUB_CYCLE)),
    cycle: hex(erd(ERD_TYPES.LAUNDRY_CYCLE)),
  }
}
const laundryEngaged = (s: LaundrySnapshot): boolean => s.machineState !== undefined && LAUNDRY_ENGAGED.has(s.machineState)
function dryerShare(erd: ErdLookup): number {
  return dryerHeatShare(
    hex(erd(ERD_TYPES.LAUNDRY_DRYER_TEMPERATURENEW_OPTION)),
    hex(erd(ERD_TYPES.LAUNDRY_DRYER_TEMPERATURE_OPTION)),
  )
}

/** gehome WashTempLevel, as owners see it on the panel. */
export function washTempName(raw: number | undefined): string | undefined {
  return ({
    0: 'tap cold',
    16: 'tap cold',
    1: 'cold',
    17: 'cold',
    18: 'cool',
    19: 'colours',
    2: 'warm',
    20: 'warm',
    3: 'hot',
    21: 'hot',
    4: 'extra hot',
    22: 'extra hot',
  } as Record<number, string>)[raw ?? -1]
}

/** Dryer heat setting name, preferring the newer encoding like dryerHeatShare. */
export function dryerHeatName(newOption: number | undefined, oldOption: number | undefined): string | undefined {
  const names = [
    'no heat',
    'extra low heat',
    'low heat',
    'medium heat',
    'high heat',
  ]
  if (newOption !== undefined && newOption >= 1 && newOption <= 5) {
    return names[newOption - 1]
  }
  if (oldOption !== undefined && oldOption >= 0 && oldOption <= 4) {
    return names[oldOption]
  }
  return undefined
}

const LAUNDRY_STATE_NAMES: Record<number, string> = {
  0: 'Idle',
  1: 'Standby',
  3: 'Paused',
  4: 'Cycle finished',
  5: 'Delayed start',
  6: 'Delayed start',
  7: 'Delayed start, paused',
  8: 'Draining',
  10: 'Flushing',
}

/** "Wash, warm" while running; the machine state otherwise. */
function describeLaundry(erd: ErdLookup, setting: string | undefined): string | undefined {
  const s = laundrySnapshot(erd)
  if (s.machineState === undefined) {
    return undefined
  }
  if (s.machineState !== 2) {
    return LAUNDRY_STATE_NAMES[s.machineState] ?? `State ${s.machineState}`
  }
  const phase = s.subCycle
    ? combinationSubCycleName(s.subCycle)
    : ''
  return [phase || 'Running', setting].filter(Boolean).join(', ')
}

/** The selected programme, e.g. "Cottons"; undefined when none is reported. */
function laundryCycleName(erd: ErdLookup): string | undefined {
  const code = hex(erd(ERD_TYPES.LAUNDRY_CYCLE))
  return code
    ? combinationCycleName(code)
    : undefined
}
const washSetting = (erd: ErdLookup) => washTempName(hex(erd(ERD_TYPES.LAUNDRY_WASHER_WASHTEMP_LEVEL)))
function drySetting(erd: ErdLookup) {
  return dryerHeatName(
    hex(erd(ERD_TYPES.LAUNDRY_DRYER_TEMPERATURENEW_OPTION)),
    hex(erd(ERD_TYPES.LAUNDRY_DRYER_TEMPERATURE_OPTION)),
  )
}

export const washerModel: EnergyModel = {
  key: 'washer',
  label: 'Washer',
  tileName: 'Washer Running',
  subtype: 'WasherRunning',
  replacesSwitch: 'WasherRunning',
  erds: [...LAUNDRY_ERDS, ERD_TYPES.LAUNDRY_WASHER_WASHTEMP_LEVEL],
  defaults: DEFAULT_WASHER_PROFILE,
  estimate: ({ erd }, p) => {
    const s = {
      ...laundrySnapshot(erd),
      temperature: hex(erd(ERD_TYPES.LAUNDRY_WASHER_WASHTEMP_LEVEL)),
    }
    return reading(estimateWasherWatts(s, p), laundryEngaged(s))
  },
  describe: ({ erd }) => describeLaundry(erd, washSetting(erd)),
  cycleName: ({ erd }) => laundryCycleName(erd),
}

export const dryerModel: EnergyModel = {
  key: 'dryer',
  label: 'Dryer',
  tileName: 'Dryer Running',
  subtype: 'DryerRunning',
  replacesSwitch: 'DryerRunning',
  erds: [...LAUNDRY_ERDS, ERD_TYPES.LAUNDRY_DRYER_TEMPERATURENEW_OPTION, ERD_TYPES.LAUNDRY_DRYER_TEMPERATURE_OPTION],
  defaults: DEFAULT_DRYER_PROFILE,
  estimate: ({ erd }, p) => {
    const s = {
      ...laundrySnapshot(erd),
      temperature: dryerShare(erd),
    }
    return reading(estimateDryerWatts(s, p), laundryEngaged(s))
  },
  describe: ({ erd }) => describeLaundry(erd, drySetting(erd)),
  cycleName: ({ erd }) => laundryCycleName(erd),
}

/**
 * Combination washer/dryers wash with the washer phases (sub-cycle < 128) and
 * dry with the dryer phases (>= 128). One heater figure serves both: combos
 * typically heat wash water with an element and dry with a heat pump or a
 * smaller element, so the drying phase uses 60% of it.
 */
export const washerDryerModel: EnergyModel = {
  key: 'washerDryer',
  label: 'Washer/Dryer',
  tileName: 'Washer/Dryer Running',
  subtype: 'WasherDryerRunning',
  replacesSwitch: 'WasherDryerRunning',
  erds: [
    ...LAUNDRY_ERDS,
    ERD_TYPES.LAUNDRY_WASHER_WASHTEMP_LEVEL,
    ERD_TYPES.LAUNDRY_DRYER_TEMPERATURENEW_OPTION,
    ERD_TYPES.LAUNDRY_DRYER_TEMPERATURE_OPTION,
  ],
  defaults: {
    standbyWatts: 2,
    motorWatts: 150,
    spinWatts: 400,
    heaterWatts: 1500,
  },
  estimate: ({ erd }, p) => {
    const s = laundrySnapshot(erd)
    const watts = (s.subCycle ?? 0) >= 128
      ? estimateDryerWatts({
          ...s,
          temperature: dryerShare(erd),
        }, { ...p, heaterWatts: p.heaterWatts * 0.6 })
      : estimateWasherWatts({
          ...s,
          temperature: hex(erd(ERD_TYPES.LAUNDRY_WASHER_WASHTEMP_LEVEL)),
        }, p)
    return reading(watts, laundryEngaged(s))
  },
  describe: ({ erd }) => describeLaundry(erd, (hex(erd(ERD_TYPES.LAUNDRY_SUB_CYCLE)) ?? 0) >= 128
    ? drySetting(erd)
    : washSetting(erd)),
  cycleName: ({ erd }) => laundryCycleName(erd),
}

// --- kitchen ----------------------------------------------------------------

/**
 * Dishwasher: pump (motor) and water/drying heater, by gehome's raw cycle state
 * (DISHWASHER_CYCLE_STATE). Active while operating mode is 5 (running).
 */
export const dishwasherModel: EnergyModel = {
  key: 'dishwasher',
  label: 'Dishwasher',
  erds: [ERD_TYPES.DISHWASHER_OPERATING_MODE, ERD_TYPES.DISHWASHER_CYCLE_STATE],
  defaults: {
    standbyWatts: 1,
    motorWatts: 80,
    spinWatts: 0,
    heaterWatts: 1200,
  },
  estimate: ({ erd }, p) => {
    const running = hex(erd(ERD_TYPES.DISHWASHER_OPERATING_MODE)) === 5
    if (!running) {
      return reading(p.standbyWatts, false)
    }
    let phase: number
    switch (hex(erd(ERD_TYPES.DISHWASHER_CYCLE_STATE))) {
      case 1:
      case 10:
      case 12: // pre-wash
        phase = p.motorWatts + p.heaterWatts * 0.15
        break
      case 3: // main wash, heating the water
        phase = p.motorWatts + p.heaterWatts * 0.5
        break
      case 4: // heated dry
        phase = p.heaterWatts * 0.4
        break
      case 5: // sanitising rinse
        phase = p.motorWatts + p.heaterWatts * 0.8
        break
      case 13:
      case 14:
      case 15: // auto hot start
        phase = p.heaterWatts
        break
      case 9:
      case 11:
      case 16: // rinses
        phase = p.motorWatts + p.heaterWatts * 0.3
        break
      case 8: // paused
        phase = 0
        break
      default: // sensing, calibration, unreported
        phase = p.motorWatts
    }
    return reading(p.standbyWatts + phase, true)
  },
  describe: ({ erd }) => {
    const mode = hex(erd(ERD_TYPES.DISHWASHER_OPERATING_MODE))
    if (mode === undefined) {
      return undefined
    }
    if (mode !== 5) {
      return ({
        0: 'Low power',
        1: 'Powering up',
        2: 'Standby',
        3: 'Delayed start',
        4: 'Paused',
        6: 'Cycle finished',
        11: 'Off',
      } as Record<number, string>)[mode] ?? `Mode ${mode}`
    }
    const state = hex(erd(ERD_TYPES.DISHWASHER_CYCLE_STATE))
    return ({
      1: 'Pre-wash',
      2: 'Sensing',
      3: 'Main wash',
      4: 'Drying',
      5: 'Sanitising',
      8: 'Paused',
      9: 'Rinsing',
      10: 'Pre-wash',
      11: 'Final rinse',
      12: 'Pre-wash',
      13: 'Heating water',
      14: 'Heating water',
      15: 'Heating water',
      16: 'Final rinse',
    } as Record<number, string>)[state ?? -1] ?? 'Running'
  },
}

/** DishDrawer: each running drawer (status byte 1 = 0x04) adds pump + averaged heater. */
export const dishDrawerModel: EnergyModel = {
  key: 'dishDrawer',
  label: 'DishDrawer',
  erds: ['0x3007', '0x3207'],
  defaults: {
    standbyWatts: 1,
    motorWatts: 60,
    spinWatts: 0,
    heaterWatts: 1200,
  },
  estimate: ({ erd }, p) => {
    const running = ['0x3007', '0x3207'].filter(e => hex(erd(e)?.replace(/^0x/i, '').slice(2, 4)) === 0x04).length
    return reading(p.standbyWatts + running * (p.motorWatts + p.heaterWatts * 0.4), running > 0)
  },
  describe: ({ erd }) => {
    const running = ['0x3007', '0x3207'].filter(e => hex(erd(e)?.replace(/^0x/i, '').slice(2, 4)) === 0x04).length
    return running === 2
      ? 'Both drawers running'
      : running === 1
        ? 'One drawer running'
        : 'Idle'
  },
}

/** COOKTOP_STATUS: byte 0 non-zero = on; per burner a flag byte (0x40 = on) and a power level 0-0x4B. */
export function cooktopWatts(status: string | undefined, burnerWatts: number): number {
  if (!status || status.length < 2 || hex(status.slice(0, 2)) === 0) {
    return 0
  }
  if (status.length < 26) {
    return burnerWatts * 0.5 // on, but no per-burner breakdown
  }
  let total = 0
  for (let slot = 0; slot < 6; slot++) {
    const flags = hex(status.slice(2 + slot * 4, 4 + slot * 4)) ?? 0
    const level = hex(status.slice(4 + slot * 4, 6 + slot * 4)) ?? 0
    if (flags & 0x40) {
      total += burnerWatts * Math.min(level / 0x4B, 1)
    }
  }
  return total
}

/** Induction cooktop: heater = one burner at full power. */
export const cooktopModel: EnergyModel = {
  key: 'cooktop',
  label: 'Cooktop',
  erds: [ERD_TYPES.COOKTOP_STATUS],
  defaults: {
    standbyWatts: 1,
    motorWatts: 0,
    spinWatts: 0,
    heaterWatts: 2200,
  },
  estimate: ({ erd }, p) => {
    const burners = cooktopWatts(erd(ERD_TYPES.COOKTOP_STATUS), p.heaterWatts)
    return reading(p.standbyWatts + burners, burners > 0)
  },
  describe: ({ erd }) => describeCooktop(erd(ERD_TYPES.COOKTOP_STATUS)),
}

/** "2 burners on", "Off", or "On" when the status has no per-burner detail. */
export function describeCooktop(status: string | undefined): string | undefined {
  if (!status || status.length < 2) {
    return undefined
  }
  if (hex(status.slice(0, 2)) === 0) {
    return 'Off'
  }
  if (status.length < 26) {
    return 'On'
  }
  let lit = 0
  for (let slot = 0; slot < 6; slot++) {
    if ((hex(status.slice(2 + slot * 4, 4 + slot * 4)) ?? 0) & 0x40) {
      lit++
    }
  }
  return lit === 1
    ? '1 burner on'
    : `${lit} burners on`
}

/**
 * One oven cavity: full element while preheating (display well below set),
 * then a ~35% duty cycle holding temperature. Mode bytes are the plugin's own
 * (UPPER/LOWER_OVEN_COOK_MODE: mode byte + 16-bit set temperature °F).
 */
export function ovenCavityWatts(state: string | undefined, cookMode: string | undefined, displayTemp: string | undefined, elementWatts: number): number {
  const s = hex(state)
  if (s === undefined || s === 0 || s === 0xCC) { // 0xCC: no such cavity (#109)
    return 0
  }
  const mode = cookMode && cookMode.length >= 6
    ? hex(cookMode.slice(0, 2))
    : undefined
  const setF = cookMode && cookMode.length >= 6
    ? hex(cookMode.slice(2, 6))
    : undefined
  const nowF = hex(displayTemp)
  const convection = mode === 0x1B || mode === 0x24 || mode === 0x9E
    ? 1.1
    : 1 // fan + extra element
  if (setF && nowF !== undefined && nowF < setF - 25) {
    return elementWatts * convection // preheating
  }
  return elementWatts * 0.35 * convection
}

/** Oven / range: heater = main cavity element, motor = lower cavity element; plus a range's cooktop. */
export const ovenModel: EnergyModel = {
  key: 'oven',
  label: 'Oven',
  erds: [
    ERD_TYPES.UPPER_OVEN_CURRENT_STATE,
    ERD_TYPES.UPPER_OVEN_COOK_MODE,
    ERD_TYPES.UPPER_OVEN_DISPLAY_TEMPERATURE,
    ERD_TYPES.LOWER_OVEN_CURRENT_STATE,
    ERD_TYPES.LOWER_OVEN_COOK_MODE,
    ERD_TYPES.LOWER_OVEN_DISPLAY_TEMPERATURE,
    ERD_TYPES.COOKTOP_STATUS,
  ],
  defaults: {
    standbyWatts: 3,
    motorWatts: 2500,
    spinWatts: 0,
    heaterWatts: 3500,
  },
  estimate: ({ erd }, p) => {
    const upper = ovenCavityWatts(erd(ERD_TYPES.UPPER_OVEN_CURRENT_STATE), erd(ERD_TYPES.UPPER_OVEN_COOK_MODE), erd(ERD_TYPES.UPPER_OVEN_DISPLAY_TEMPERATURE), p.heaterWatts)
    const lower = ovenCavityWatts(erd(ERD_TYPES.LOWER_OVEN_CURRENT_STATE), erd(ERD_TYPES.LOWER_OVEN_COOK_MODE), erd(ERD_TYPES.LOWER_OVEN_DISPLAY_TEMPERATURE), p.motorWatts)
    const hob = cooktopWatts(erd(ERD_TYPES.COOKTOP_STATUS), 1800)
    const load = upper + lower + hob
    return reading(p.standbyWatts + load, load > 0)
  },
  describe: ({ erd }) => {
    const cavity = (name: string, state: string, mode: string, display: string): string | undefined => {
      const st = hex(erd(state))
      if (st === undefined || st === 0 || st === 0xCC) {
        return undefined
      }
      const cm = erd(mode)
      const setF = cm && cm.length >= 6
        ? hex(cm.slice(2, 6))
        : undefined
      const nowF = hex(erd(display))
      const heating = setF && nowF !== undefined && nowF < setF - 25
      return `${name} ${heating ? 'preheating' : 'cooking'}${setF
        ? ` at ${setF} °F`
        : ''}`
    }
    const parts = [
      cavity('Oven', ERD_TYPES.UPPER_OVEN_CURRENT_STATE, ERD_TYPES.UPPER_OVEN_COOK_MODE, ERD_TYPES.UPPER_OVEN_DISPLAY_TEMPERATURE),
      cavity('Lower oven', ERD_TYPES.LOWER_OVEN_CURRENT_STATE, ERD_TYPES.LOWER_OVEN_COOK_MODE, ERD_TYPES.LOWER_OVEN_DISPLAY_TEMPERATURE),
    ].filter(Boolean) as string[]
    const hob = describeCooktop(erd(ERD_TYPES.COOKTOP_STATUS))
    if (hob && hob !== 'Off') {
      parts.push(`cooktop ${hob.toLowerCase()}`)
    }
    return parts.length
      ? parts.join(', ')
      : 'Off'
  },
}

/** Fixed-average models for classes that read no state yet. */
function fixedModel(key: string, label: string, standbyWatts: number, alwaysOn = false): EnergyModel {
  return {
    key,
    label,
    erds: [],
    alwaysOn,
    fixed: true,
    defaults: {
      standbyWatts,
      motorWatts: 0,
      spinWatts: 0,
      heaterWatts: 0,
    },
    estimate: (_ctx, p) => reading(p.standbyWatts, alwaysOn),
    describe: () => 'Fixed average - this appliance reports no usable state yet',
  }
}

export const microwaveModel = fixedModel('microwave', 'Microwave', 2)
export const advantiumModel = fixedModel('advantium', 'Advantium', 3)
export const coffeeMakerModel = fixedModel('coffeeMaker', 'Coffee Maker', 1)

/** Profile smoker (v2 API): active from the class's own cooking state. Heater ~800 W, cycling. */
export const smokerModel: EnergyModel = {
  key: 'smoker',
  label: 'Smoker',
  erds: [],
  defaults: {
    standbyWatts: 2,
    motorWatts: 30,
    spinWatts: 0,
    heaterWatts: 800,
  },
  estimate: ({ externalActive }, p) => externalActive
    ? reading(p.standbyWatts + p.motorWatts + p.heaterWatts * 0.5, true)
    : reading(p.standbyWatts, false),
  describe: ({ externalActive }) => externalActive ? 'Cooking' : 'Idle',
}

/** Range hood: fan by speed (motor = boost), lights ~8 W. */
export const hoodModel: EnergyModel = {
  key: 'hood',
  label: 'Hood',
  erds: [ERD_TYPES.HOOD_FAN_SPEED, ERD_TYPES.HOOD_LIGHT_LEVEL],
  defaults: {
    standbyWatts: 1,
    motorWatts: 250,
    spinWatts: 0,
    heaterWatts: 0,
  },
  estimate: ({ erd }, p) => {
    const speed = Math.min(hex(erd(ERD_TYPES.HOOD_FAN_SPEED)) ?? 0, 4)
    const light = (hex(erd(ERD_TYPES.HOOD_LIGHT_LEVEL)) ?? 0) > 0
      ? 8
      : 0
    const fan = [0, 0.2, 0.4, 0.7, 1][speed] * p.motorWatts
    return reading(p.standbyWatts + fan + light, fan + light > 0)
  },
  describe: ({ erd }) => {
    const speed = Math.min(hex(erd(ERD_TYPES.HOOD_FAN_SPEED)) ?? 0, 4)
    const light = (hex(erd(ERD_TYPES.HOOD_LIGHT_LEVEL)) ?? 0) > 0
    const fan = speed
      ? `Fan ${['', 'low', 'medium', 'high', 'boost'][speed]}`
      : 'Fan off'
    return `${fan}, light ${light ? 'on' : 'off'}`
  },
}

// --- cooling ----------------------------------------------------------------

/**
 * Refrigerator: standby = the average draw over a day (compressor cycling,
 * defrost, fans - 45 W is about 1.1 kWh/day). Turbo cool / freeze adds the
 * motor figure while active.
 */
export const refrigeratorModel: EnergyModel = {
  key: 'refrigerator',
  label: 'Refrigerator',
  alwaysOn: true,
  erds: [ERD_TYPES.TURBO_COOL_STATUS, ERD_TYPES.TURBO_FREEZE_STATUS],
  defaults: {
    standbyWatts: 45,
    motorWatts: 60,
    spinWatts: 0,
    heaterWatts: 0,
  },
  estimate: ({ erd }, p) => {
    const turbo = [ERD_TYPES.TURBO_COOL_STATUS, ERD_TYPES.TURBO_FREEZE_STATUS].filter(e => (hex(erd(e)) ?? 0) !== 0).length
    return reading(p.standbyWatts + turbo * p.motorWatts, true)
  },
  describe: ({ erd }) => {
    const on = [
      [ERD_TYPES.TURBO_COOL_STATUS, 'turbo cool'],
      [ERD_TYPES.TURBO_FREEZE_STATUS, 'turbo freeze'],
    ]
      .filter(([e]) => (hex(erd(e)) ?? 0) !== 0)
      .map(([, name]) => name)
    return on.length
      ? `Daily average, ${on.join(' and ')} on`
      : 'Daily average'
  },
}

export const beverageCenterModel = fixedModel('beverageCenter', 'Beverage Center', 35, true)

/** In-fridge Keurig hot water tank: heater runs while status byte is 01 (heating). */
export const keurigModel: EnergyModel = {
  key: 'keurig',
  label: 'Keurig',
  erds: [ERD_TYPES.HOT_WATER_STATUS],
  defaults: {
    standbyWatts: 1,
    motorWatts: 0,
    spinWatts: 0,
    heaterWatts: 700,
  },
  estimate: ({ erd }, p) => {
    const heating = byte0(erd(ERD_TYPES.HOT_WATER_STATUS)) === 0x01
    return reading(p.standbyWatts + (heating ? p.heaterWatts : 0), heating)
  },
  describe: ({ erd }) => ({
    0: 'Not heating',
    1: 'Heating',
    2: 'Ready',
    0xFD: 'Fault',
    0xFE: 'Fault',
  } as Record<number, string>)[byte0(erd(ERD_TYPES.HOT_WATER_STATUS)) ?? -1],
}

/**
 * Opal nugget ice maker: compressor (heater figure) while making ice, half of
 * it defrosting, fan only (motor) when the bin is full or idle.
 */
export const iceMakerModel: EnergyModel = {
  key: 'iceMaker',
  label: 'Ice Maker',
  erds: [ERD_TYPES.OIM_POWER, ERD_TYPES.OIM_STATUS],
  defaults: {
    standbyWatts: 2,
    motorWatts: 15,
    spinWatts: 0,
    heaterWatts: 120,
  },
  estimate: ({ erd }, p) => {
    if ((hex(erd(ERD_TYPES.OIM_POWER)) ?? 0) === 0) {
      return reading(p.standbyWatts, false)
    }
    switch (byte0(erd(ERD_TYPES.OIM_STATUS))) {
      case 0: // making ice
        return reading(p.standbyWatts + p.motorWatts + p.heaterWatts, true)
      case 1: // defrosting
        return reading(p.standbyWatts + p.heaterWatts * 0.5, true)
      case 2: // cleaning
        return reading(p.standbyWatts + p.motorWatts * 2, true)
      default: // bin full, idle, add water, lid open
        return reading(p.standbyWatts + p.motorWatts, true)
    }
  },
  describe: ({ erd }) => {
    if ((hex(erd(ERD_TYPES.OIM_POWER)) ?? 0) === 0) {
      return 'Off'
    }
    return ({
      0: 'Making ice',
      1: 'Defrosting',
      2: 'Cleaning',
      3: 'Bin full',
      4: 'Add water',
      5: 'Bin missing',
      6: 'Idle',
      7: 'No water source',
      8: 'Lid open',
    } as Record<number, string>)[byte0(erd(ERD_TYPES.OIM_STATUS)) ?? -1]
  },
}

/**
 * Air conditioner: fan (motor) by speed, plus the compressor (heater figure)
 * in cool / dry / energy saver / heat. Full compressor while the room is
 * still away from the set point, a 30% duty once it is there; energy saver
 * cycles the fan off with the compressor.
 */
export const airConditionerModel: EnergyModel = {
  key: 'airConditioner',
  label: 'Air Conditioner',
  erds: [
    ERD_TYPES.AIR_CONDITIONER_POWER_STATUS,
    ERD_TYPES.AIR_CONDITIONER_OPERATION_MODE,
    ERD_TYPES.AIR_CONDITIONER_FAN_SETTING,
    ERD_TYPES.AIR_CONDITIONER_AMBIENT_TEMPERATURE,
    ERD_TYPES.AIR_CONDITIONER_TARGET_TEMPERATURE,
  ],
  defaults: {
    standbyWatts: 1,
    motorWatts: 60,
    spinWatts: 0,
    heaterWatts: 900,
  },
  estimate: ({ erd }, p) => {
    if (hex(erd(ERD_TYPES.AIR_CONDITIONER_POWER_STATUS)) !== 1) {
      return reading(p.standbyWatts, false)
    }
    // FanSetting: 01 auto, 02 low, 04 med, 08 high
    const fanShare = ({ 1: 0.7, 2: 0.4, 4: 0.7, 8: 1 } as Record<number, number>)[hex(erd(ERD_TYPES.AIR_CONDITIONER_FAN_SETTING)) ?? 1] ?? 0.7
    const fan = p.motorWatts * fanShare
    const mode = hex(erd(ERD_TYPES.AIR_CONDITIONER_OPERATION_MODE))
    if (mode === 1) { // fan only
      return reading(p.standbyWatts + fan, true)
    }
    const ambientF = hex(erd(ERD_TYPES.AIR_CONDITIONER_AMBIENT_TEMPERATURE))
    const targetF = hex(erd(ERD_TYPES.AIR_CONDITIONER_TARGET_TEMPERATURE))
    const heating = mode === 3
    let duty = 0.6 // temperatures unknown
    if (ambientF !== undefined && targetF !== undefined) {
      const away = heating
        ? targetF - ambientF
        : ambientF - targetF
      duty = away > 1
        ? 1
        : 0.3
    }
    if (mode === 4) { // dry: compressor at low speed
      duty = Math.min(duty, 0.5)
    }
    const compressor = p.heaterWatts * duty
    const fanDraw = mode === 2
      ? fan * duty
      : fan // energy saver: fan cycles too
    return reading(p.standbyWatts + fanDraw + compressor, true)
  },
  describe: ({ erd }) => {
    if (hex(erd(ERD_TYPES.AIR_CONDITIONER_POWER_STATUS)) !== 1) {
      return 'Off'
    }
    const mode = ({
      0: 'Cooling',
      1: 'Fan only',
      2: 'Energy saver',
      3: 'Heating',
      4: 'Drying',
    } as Record<number, string>)[hex(erd(ERD_TYPES.AIR_CONDITIONER_OPERATION_MODE)) ?? -1] ?? 'On'
    const target = hex(erd(ERD_TYPES.AIR_CONDITIONER_TARGET_TEMPERATURE))
    return target !== undefined && mode !== 'Fan only'
      ? `${mode} to ${target} °F`
      : mode
  },
}

// --- water ------------------------------------------------------------------

/**
 * Water heater: heating while the tank is more than ~2.5 °C under its set
 * point. Heater defaults to a heat pump unit (GeoSpring, ~550 W); set 4500 for
 * an element-only tank. Vacation mode: standby only.
 */
export const waterHeaterModel: EnergyModel = {
  key: 'waterHeater',
  label: 'Water Heater',
  erds: [ERD_TYPES.WATER_HEATER_MODE, ERD_TYPES.WATER_HEATER_CURRENT_TEMPERATURE, ERD_TYPES.WATER_HEATER_TARGET_TEMPERATURE],
  defaults: {
    standbyWatts: 3,
    motorWatts: 0,
    spinWatts: 0,
    heaterWatts: 550,
  },
  estimate: ({ erd }, p) => {
    if (erd(ERD_TYPES.WATER_HEATER_MODE) === '04') { // vacation
      return reading(p.standbyWatts, false)
    }
    const tenthsF = (v: string | undefined): number | undefined => {
      const n = hex(v)
      return n === undefined
        ? undefined
        : fToC(n / 10)
    }
    const current = tenthsF(erd(ERD_TYPES.WATER_HEATER_CURRENT_TEMPERATURE))
    const target = tenthsF(erd(ERD_TYPES.WATER_HEATER_TARGET_TEMPERATURE))
    const heating = current !== undefined && target !== undefined && current < target - 2.5
    return reading(p.standbyWatts + (heating ? p.heaterWatts : 0), heating)
  },
  describe: ({ erd }) => {
    if (erd(ERD_TYPES.WATER_HEATER_MODE) === '04') {
      return 'Vacation'
    }
    const tenths = (v: string | undefined) => {
      const n = hex(v)
      return n === undefined
        ? undefined
        : n / 10
    }
    const current = tenths(erd(ERD_TYPES.WATER_HEATER_CURRENT_TEMPERATURE))
    const target = tenths(erd(ERD_TYPES.WATER_HEATER_TARGET_TEMPERATURE))
    if (current === undefined || target === undefined) {
      return undefined
    }
    return `${fToC(current) < fToC(target) - 2.5
      ? 'Heating'
      : 'Holding'}, tank ${Math.round(current)} of ${Math.round(target)} °F`
  },
}

/** Whole-home water filter: controls and valve only. */
export const waterFilterModel = fixedModel('waterFilter', 'Water Filter', 2, true)
/** Water softener: controls; regeneration is not reported yet. */
export const waterSoftenerModel = fixedModel('waterSoftener', 'Water Softener', 3, true)

export const ENERGY_MODELS = {
  washer: washerModel,
  dryer: dryerModel,
  washerDryer: washerDryerModel,
  dishwasher: dishwasherModel,
  dishDrawer: dishDrawerModel,
  oven: ovenModel,
  cooktop: cooktopModel,
  microwave: microwaveModel,
  advantium: advantiumModel,
  coffeeMaker: coffeeMakerModel,
  smoker: smokerModel,
  hood: hoodModel,
  refrigerator: refrigeratorModel,
  beverageCenter: beverageCenterModel,
  keurig: keurigModel,
  iceMaker: iceMakerModel,
  airConditioner: airConditionerModel,
  waterHeater: waterHeaterModel,
  waterFilter: waterFilterModel,
  waterSoftener: waterSoftenerModel,
} as const satisfies Record<string, EnergyModel>

/**
 * Which models an appliance gets, by the type string SmartHQ reports. Mirrors
 * the discovery switch in platform.ts, for the settings page, which only sees
 * cached accessories and the config. A fridge lists the Keurig too: it gets a
 * Keurig tile when the fridge has the brewer.
 */
export const ENERGY_MODELS_BY_APPLIANCE_TYPE: Record<string, Array<keyof typeof ENERGY_MODELS>> = {
  'Dishwasher': ['dishwasher'],
  'FP DishDrawer': ['dishDrawer'],
  'Oven': ['oven'],
  'Refrigerator': ['refrigerator', 'keurig'],
  'Opal Nugget Ice Maker': ['iceMaker'],
  'Air Conditioner': ['airConditioner'],
  'Portable AC': ['airConditioner'],
  'Split Air Conditioner': ['airConditioner'],
  'Through Wall AC': ['airConditioner'],
  'Hood': ['hood'],
  'Clothes Washer': ['washer'],
  'Clothes Dryer': ['dryer'],
  'Combination Washer Dryer': ['washerDryer'],
  'Whole Home Water Filter': ['waterFilter'],
  'Home Water Filter': ['waterFilter'],
  'Whole Home Water Softener': ['waterSoftener'],
  'Whole Home Water Heater': ['waterHeater'],
  'Water Heater': ['waterHeater'],
  'Advantium': ['advantium'],
  'Microwave': ['microwave'],
  'Coffee Maker': ['coffeeMaker'],
  'Espresso Maker': ['coffeeMaker'],
  'Beverage Center': ['beverageCenter'],
  'Smoker': ['smoker'],
  'Induction Cooktop': ['cooktop'],
}
