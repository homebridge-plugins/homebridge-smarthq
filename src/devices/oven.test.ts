import { describe, expect, it } from 'vitest'

import { hasLowerOvenCavity } from './oven.js'

/**
 * Regression cover for #109: a single oven was given four lower-oven tiles.
 *
 * The old gate accepted either LOWER_OVEN_RAW_TEMPERATURE *or*
 * LOWER_OVEN_CURRENT_STATE being readable. dfinstein's single oven answers
 * LOWER_OVEN_CURRENT_STATE with `CC` — a placeholder, not a real state — so
 * the gate said "double oven". It also made isLowerOvenRunning() parse 0xCC
 * as 204, i.e. permanently cooking.
 */
describe('hasLowerOvenCavity', () => {
  it('says no when the lower cavity reports no temperature (#109, single oven)', () => {
    expect(hasLowerOvenCavity(undefined)).toBe(false)
  })

  it('says yes when the lower cavity reports a temperature (#46, Cafe double oven)', () => {
    expect(hasLowerOvenCavity('015E')).toBe(true)
  })

  it('accepts a cold lower cavity reporting zero', () => {
    // A real second cavity that is simply cold still answers the ERD. The
    // check must be "did it answer", never "is the value non-zero", or a
    // double oven would lose its tiles whenever it was cool.
    expect(hasLowerOvenCavity('0000')).toBe(true)
  })

  it('is not fooled by the placeholder state a single oven returns', () => {
    // `CC` is what #109's oven returns for LOWER_OVEN_CURRENT_STATE. The
    // current state is no longer consulted at all, so no value of it can
    // bring the lower tiles back on a single oven.
    expect(hasLowerOvenCavity(undefined)).toBe(false)
  })
})
