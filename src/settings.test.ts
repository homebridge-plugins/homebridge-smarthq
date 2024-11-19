import { describe, expect, it } from 'vitest'

import { ERD_CODES, ERD_TYPES } from './settings.js'

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
