import { describe, expect, it } from 'vitest'

import { enabledCookModes, hasLowerOvenCavity, matterSupportedModes, OVEN_COOK_MODES } from './oven.js'

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

/**
 * Cooking modes (#111).
 *
 * The mode bytes were read off a real JS760SP6SS by switching mode in the
 * SmartHQ app and watching UPPER_OVEN_COOK_MODE. They are pinned here because
 * they are not derivable — an earlier Matter list carried invented values
 * (Convection Bake 2, Broil High 3, Broil Low 4) that no oven would honour.
 */
describe('oven cooking modes', () => {
  it('pins the mode bytes observed on a real oven', () => {
    const byKey = Object.fromEntries(OVEN_COOK_MODES.map(m => [m.key, m.mode]))
    expect(byKey).toEqual({
      BAKE: 0x01,
      CONV_BAKE_MULTI: 0x1B,
      CONV_ROAST: 0x24,
      AIR_FRY: 0x9E,
    })
  })

  it('exposes nothing at all by default, so an existing oven is unchanged', () => {
    expect(enabledCookModes({})).toEqual([])
    expect(matterSupportedModes({})).toEqual([{ label: 'Off', mode: 0 }])
  })

  it('ignores an option that is present but false', () => {
    expect(enabledCookModes({ showAirFrySwitch: false })).toEqual([])
  })

  it('exposes only the modes switched on', () => {
    const enabled = enabledCookModes({ showAirFrySwitch: true, showConvRoastSwitch: true })
    expect(enabled.map(m => m.label)).toEqual(['Convection Roast', 'Air Fry'])
  })

  it('gives matter the appliance byte as the mode number, not a second numbering', () => {
    // If these ever diverge, a Matter controller would start a different mode
    // from the HomeKit switch of the same name.
    expect(matterSupportedModes({ showAirFrySwitch: true })).toEqual([
      { label: 'Off', mode: 0 },
      { label: 'Air Fry', mode: 0x9E },
    ])
  })

  it('keeps Off first, as Matter requires a defined off mode', () => {
    const all = matterSupportedModes({
      showBakeSwitch: true,
      showConvBakeMultiSwitch: true,
      showConvRoastSwitch: true,
      showAirFrySwitch: true,
    })
    expect(all[0]).toEqual({ label: 'Off', mode: 0 })
    expect(all).toHaveLength(5)
  })

  it('has a unique key, label and byte for every mode', () => {
    expect(new Set(OVEN_COOK_MODES.map(m => m.key)).size).toBe(OVEN_COOK_MODES.length)
    expect(new Set(OVEN_COOK_MODES.map(m => m.label)).size).toBe(OVEN_COOK_MODES.length)
    expect(new Set(OVEN_COOK_MODES.map(m => m.mode)).size).toBe(OVEN_COOK_MODES.length)
  })
})
