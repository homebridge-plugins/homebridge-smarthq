import { describe, expect, it } from 'vitest'

import { ERD_CODES, ERD_TYPES, lookupErdName, normaliseErd } from './settings.js'

describe('eRD_TYPES', () => {
  it('should have correct values', () => {
    expect(ERD_TYPES.APPLIANCE_TYPE).toBe('0x0008')
    expect(ERD_TYPES.CLOCK_FORMAT).toBe('0x0006')
    // Add more assertions for other ERD_TYPES as needed
  })
})

describe('eRD_CODES', () => {
  it('should invert ERD_TYPES correctly', () => {
    expect(ERD_CODES['0x0008']).toBe('APPLIANCE_TYPE')
    expect(ERD_CODES['0x0006']).toBe('CLOCK_FORMAT')
    // Add more assertions for other ERD_CODES as needed
  })
})

describe('normaliseErd', () => {
  it('should make hex codes comparable regardless of case', () => {
    expect(normaliseErd('0x116D')).toBe(normaliseErd('0x116d'))
    expect(normaliseErd('0x5B00')).toBe(normaliseErd('0x5b00'))
  })
})

describe('lookupErdName', () => {
  it('should find a lowercase-defined code sent in uppercase', () => {
    // settings.ts defines this one lowercase, but the websocket sends uppercase
    expect(ERD_TYPES.WATER_FILTER_LEAK_VALIDITY).toBe('0x116e')
    expect(lookupErdName('0x116E')).toBe('WATER_FILTER_LEAK_VALIDITY')
    expect(lookupErdName('0x116e')).toBe('WATER_FILTER_LEAK_VALIDITY')
  })

  it('should find an uppercase-defined code sent in lowercase', () => {
    // ...and this one is defined uppercase, so the mismatch runs both ways
    expect(ERD_TYPES.HOOD_FAN_SPEED).toBe('0x5B00')
    expect(lookupErdName('0x5b00')).toBe('HOOD_FAN_SPEED')
    expect(lookupErdName('0x5B00')).toBe('HOOD_FAN_SPEED')
  })

  it('should still resolve digit-only codes', () => {
    expect(lookupErdName(ERD_TYPES.WATER_FILTER_FLOW_RATE)).toBe('WATER_FILTER_FLOW_RATE')
  })

  it('should return undefined for an unknown code', () => {
    expect(lookupErdName('0xdead')).toBeUndefined()
  })

  it('should fix a lookup that the raw ERD_CODES map misses (#10)', () => {
    // The old code indexed ERD_CODES directly, so a case mismatch silently
    // dropped the update - exactly what a debug log showed for 0x116D
    expect(ERD_CODES['0x116E']).toBeUndefined()
    expect(lookupErdName('0x116E')).toBeDefined()
  })
})
