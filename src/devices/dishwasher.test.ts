import { describe, expect, it } from 'vitest'

import { isDishwasherDoorOpen } from './dishwasher.js'

/**
 * The door ERD reads 00 when the door is open and 01 when it is closed - the
 * reverse of what the handler used to assume, so the door tile showed open
 * whenever the dishwasher was shut (#134).
 */
describe('reading the dishwasher door', () => {
  it('treats 00 as open, as the owner\'s capture showed when opening the door', () => {
    expect(isDishwasherDoorOpen('00')).toBe(true)
  })

  it('treats 01 as closed', () => {
    expect(isDishwasherDoorOpen('01')).toBe(false)
  })

  it('never shows the door open for a missing or not-available reading', () => {
    expect(isDishwasherDoorOpen(undefined)).toBe(false)
    expect(isDishwasherDoorOpen('')).toBe(false)
    expect(isDishwasherDoorOpen('FF')).toBe(false)
  })
})
