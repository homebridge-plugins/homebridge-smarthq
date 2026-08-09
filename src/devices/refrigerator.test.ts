import { describe, expect, it } from 'vitest'

import { decodeCompartmentBytes, decodeCompartmentCelsius, encodeCompartmentBytes } from './refrigerator.js'

describe('decodeCompartmentCelsius', () => {
  it('decodes a real setpoint pair rather than reading it as a decimal number', () => {
    // "2500" is 0x25 (37°F) fridge, 0x00 (0°F) freezer - and also valid JSON for 2500
    const fridge = decodeCompartmentCelsius('2500', 'fridge')
    const freezer = decodeCompartmentCelsius('2500', 'freezer')

    expect(fridge?.via).toBe('bytes')
    expect(fridge?.celsius).toBeCloseTo(2.78, 2)
    expect(freezer?.via).toBe('bytes')
    expect(freezer?.celsius).toBeCloseTo(-17.78, 2)
  })

  it('gives the compartments different values from the same payload', () => {
    const fridge = decodeCompartmentCelsius('2500', 'fridge')!.celsius
    const freezer = decodeCompartmentCelsius('2500', 'freezer')!.celsius

    expect(fridge).not.toBeCloseTo(freezer, 2)
  })

  it('decodes a negative freezer setpoint', () => {
    // "25FE" is 37°F fridge, -2°F freezer
    expect(decodeCompartmentCelsius('25FE', 'freezer')?.celsius).toBeCloseTo(-18.89, 2)
  })

  it('treats 0x80 as -128, not +128', () => {
    expect(decodeCompartmentCelsius('8000', 'fridge')?.celsius).toBeCloseTo(-88.89, 2)
  })

  it('accepts a 0x prefix', () => {
    expect(decodeCompartmentCelsius('0x2500', 'fridge')?.via).toBe('bytes')
  })

  it.each([
    ['undefined', undefined],
    ['the string "undefined"', 'undefined'],
    ['an empty string', ''],
    ['non-hex garbage', 'zzzz'],
  ])('returns undefined for %s rather than a plausible number', (_label, input) => {
    expect(decodeCompartmentCelsius(input, 'fridge')).toBeUndefined()
  })
})

describe('decodeCompartmentBytes', () => {
  it('splits a pair into signed bytes', () => {
    expect(decodeCompartmentBytes('2500')).toEqual({ fridge: 37, freezer: 0 })
    expect(decodeCompartmentBytes('25FE')).toEqual({ fridge: 37, freezer: -2 })
  })

  it('covers both ends of the signed byte range', () => {
    expect(decodeCompartmentBytes('8000')).toEqual({ fridge: -128, freezer: 0 })
    expect(decodeCompartmentBytes('7F00')).toEqual({ fridge: 127, freezer: 0 })
  })

  it.each(['250', '25000', 'zzzz', ''])('rejects %s', (input) => {
    expect(decodeCompartmentBytes(input)).toBeUndefined()
  })
})

describe('encodeCompartmentBytes', () => {
  it('preserves the compartment that did not change', () => {
    expect(encodeCompartmentBytes(38, 0)).toBe('2600')
    expect(encodeCompartmentBytes(37, -2)).toBe('25FE')
  })

  it('round-trips across the signed byte range', () => {
    for (let f = -128; f <= 127; f += 17) {
      expect(decodeCompartmentBytes(encodeCompartmentBytes(f, -f - 1))).toEqual({ fridge: f, freezer: -f - 1 })
    }
  })

  it('clamps out-of-range input to a single byte', () => {
    expect(encodeCompartmentBytes(999, -999)).toBe('7F80')
  })
})
