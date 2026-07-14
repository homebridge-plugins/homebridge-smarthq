import { describe, expect, it } from 'vitest'

import { decideKeurigCapability, parseHotWaterStatus } from './keurig.js'

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
