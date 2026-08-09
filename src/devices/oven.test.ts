import { describe, expect, it } from 'vitest'

import { ERD_TYPES } from '../settings.js'
import { cookModeSwitchStates, enabledCookModes, hasLowerOvenCavity, matterSupportedModes, OVEN_COOK_MODES, SmartHQOven } from './oven.js'

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

  /**
   * #116: a genuine double oven whose lower cavity returns 400 for
   * LOWER_OVEN_RAW_TEMPERATURE, so the temperature gate alone hid it. Both
   * configuration values below were read off real appliances and are the only
   * two we have, so they are pinned exactly rather than paraphrased.
   */
  describe('falling back to the oven configuration', () => {
    it('finds the second cavity of a double oven that reports no lower temperature (#116)', () => {
      expect(hasLowerOvenCavity(undefined, '0888')).toBe(true)
    })

    it('leaves the single oven single (#109), so the earlier fix cannot regress', () => {
      expect(hasLowerOvenCavity(undefined, '0880')).toBe(false)
    })

    it('accepts a 0x prefix', () => {
      expect(hasLowerOvenCavity(undefined, '0x0888')).toBe(true)
    })

    it.each([
      ['not reported at all', undefined],
      ['an empty string', ''],
      ['non-hex garbage', 'zzzz'],
    ])('says no when the configuration is %s', (_label, configuration) => {
      expect(hasLowerOvenCavity(undefined, configuration)).toBe(false)
    })

    it('never takes a cavity away from an oven that does report a temperature', () => {
      // The two signals are OR'd, so a configuration without the bit cannot
      // remove the tiles from the #46 Cafe double oven
      expect(hasLowerOvenCavity('015E', '0880')).toBe(true)
    })
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

/**
 * Switch states (#111). These used to be answered only when HomeKit asked, so
 * starting or stopping the oven anywhere else left them showing a stale value.
 */
describe('cookModeSwitchStates', () => {
  const allOn = {
    showBakeSwitch: true,
    showConvBakeMultiSwitch: true,
    showConvRoastSwitch: true,
    showAirFrySwitch: true,
  }

  it('turns every switch off when the oven is off', () => {
    expect(cookModeSwitchStates(allOn, 0).every(s => !s.on)).toBe(true)
  })

  // readCookMode returns undefined if the oven cannot be read. Guessing "still
  // cooking" there would leave a switch on with the oven cold.
  it('turns every switch off when the mode could not be read', () => {
    expect(cookModeSwitchStates(allOn, undefined).every(s => !s.on)).toBe(true)
  })

  it('turns on exactly the switch for the running mode', () => {
    const states = cookModeSwitchStates(allOn, 0x9E)
    expect(states.filter(s => s.on).map(s => s.key)).toEqual(['AIR_FRY'])
  })

  it('reports nothing for a mode the oven is in but the user has not enabled', () => {
    // Bake started from the thermostat, with only the Air Fry switch enabled.
    expect(cookModeSwitchStates({ showAirFrySwitch: true }, 0x01)).toEqual([{ key: 'AIR_FRY', on: false }])
  })
})

/**
 * #116: the display temperature was used as a stand-in when the raw thermistor
 * reading was missing. ssaisusheel's live bake showed the two are different
 * measurements rather than two sources for one — the display ran 20-30°F above
 * raw throughout, matching the appliance's front panel while raw matched the
 * Home app. On their lower cavity the display ERD is worse still: frozen at
 * 0x0064 (100°F) even mid-bake.
 */
describe('cavity temperature, without the display fallback', () => {
  function ovenReporting(values: Record<string, string | undefined>) {
    const oven = Object.create(SmartHQOven.prototype)
    oven.try_get_erd_value = async (erd: string) => values[erd]
    return oven
  }

  it('reads the lower cavity from the raw thermistor', async () => {
    const oven = ovenReporting({ [ERD_TYPES.LOWER_OVEN_RAW_TEMPERATURE]: '00B1' })

    // 0xB1 = 177°F = 80.6°C
    expect(await oven.getLowerCavityTempC()).toBeCloseTo(80.56, 1)
  })

  it('reports nothing for a lower cavity that only has the display placeholder', async () => {
    const oven = ovenReporting({
      [ERD_TYPES.LOWER_OVEN_RAW_TEMPERATURE]: undefined,
      [ERD_TYPES.LOWER_OVEN_DISPLAY_TEMPERATURE]: '0064',
    })

    // Falling back would report a confident, permanent 100°F
    expect(await oven.getLowerCavityTempC()).toBeUndefined()
  })

  it('reports nothing for an upper cavity with only the display reading', async () => {
    const oven = ovenReporting({
      [ERD_TYPES.UPPER_OVEN_RAW_TEMPERATURE]: undefined,
      [ERD_TYPES.UPPER_OVEN_DISPLAY_TEMPERATURE]: '00CC',
    })

    expect(await oven.getCavityTempC()).toBeUndefined()
  })

  it('never substitutes the display value, which reads 20-30F high', async () => {
    const oven = ovenReporting({
      [ERD_TYPES.UPPER_OVEN_RAW_TEMPERATURE]: '00B1', // 177F, what the Home app shows
      [ERD_TYPES.UPPER_OVEN_DISPLAY_TEMPERATURE]: '00CC', // 204F, the front panel
    })

    expect(await oven.getCavityTempC()).toBeCloseTo(80.56, 1)
  })
})
