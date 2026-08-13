import { describe, expect, it } from 'vitest'

import { celsiusToWaterHeaterTenths, waterHeaterTenthsToCelsius } from './waterHeater.js'

/**
 * #117: the water heater was a placeholder. Every reading returned a literal
 * 50°C - which HomeKit showed as 122°F - so the tile read 122 whatever the tank
 * was doing, and the controls logged a line and sent nothing.
 *
 * The values below are the ones a GE50S10BLM01 published while its owner
 * changed the panel from 120 to 125 and back, which is what identified the two
 * ERDs in the first place.
 */
describe('reading a water heater temperature', () => {
  it.each([
    ['04E2', 125], // the owner set 125 on the panel
    ['04B0', 120], // and then set it back to 120
  ])('reads %s as %i°F', (raw, fahrenheit) => {
    const celsius = waterHeaterTenthsToCelsius(raw)
    expect(celsius).toBeDefined()
    expect(Math.round((celsius! * 9) / 5 + 32)).toBe(fahrenheit)
  })

  it('reads the tank drifting between setpoints', () => {
    // 0481 and 0480 are 115.3°F and 115.2°F - a real tank losing heat, which is
    // how the current temperature was told apart from the setpoint
    expect(waterHeaterTenthsToCelsius('0481')).toBeCloseTo(46.3, 1)
    expect(waterHeaterTenthsToCelsius('0480')).toBeCloseTo(46.2, 1)
  })

  /**
   * A missing or unreadable value must be distinguishable from a real one, so
   * the caller can hold its last reading instead of publishing a temperature
   * nobody measured. Returning a number here is what produced the 122.
   */
  it.each([undefined, '', 'zz'])('says nothing rather than guessing for %s', (raw) => {
    expect(waterHeaterTenthsToCelsius(raw)).toBeUndefined()
  })

  it('round-trips a setpoint back to what the appliance sent', () => {
    const celsius = waterHeaterTenthsToCelsius('04B0')
    expect(celsiusToWaterHeaterTenths(celsius!)).toBe('04B0')
  })

  /**
   * HomeKit works in celsius and steps its setpoint by one, so the value it
   * sends rarely lands on a whole fahrenheit degree. Writing the exact
   * conversion made the heater's own panel read a degree below the one asked
   * for - 51°C is 123.8°F, and the panel shows whole degrees (#117).
   */
  it('writes a whole fahrenheit degree, which is what the panel shows', () => {
    // 51°C is 123.8°F - the appliance should be asked for 124, not 123.8
    expect(celsiusToWaterHeaterTenths(51)).toBe('04D8')
    expect(Number.parseInt('04D8', 16) / 10).toBe(124)
  })

  it('is stable when a setpoint is read back and written again', () => {
    // A value the appliance sent must survive a round trip unchanged, or the
    // two would walk apart a degree at a time
    for (const raw of ['04B0', '04D8', '0546']) {
      const celsius = waterHeaterTenthsToCelsius(raw)
      expect(celsiusToWaterHeaterTenths(celsius!)).toBe(raw)
    }
  })
})
