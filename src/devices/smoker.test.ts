import { describe, expect, it } from 'vitest'

import { cavitySetpointCelsius, clampToHomeKitCelsius, clampToHomeKitTarget, readCelsius, SmartHQSmoker } from './smoker.js'

/**
 * The values below were read off a live Profile smoker (P9SBAAS6VBB) part way
 * through a five-hour pork rib cook — the same session that established the
 * appliance publishes nothing usable over v1 ERDs and had to be driven over v2.
 */
describe('reading a smoker temperature', () => {
  it('prefers the celsius the API already converted', () => {
    // the grate, holding its 225°F setpoint's overshoot during the smoke phase
    expect(readCelsius({ celsiusConverted: 126.66666666666667, fahrenheit: 260 })).toBeCloseTo(126.7, 1)
  })

  it('converts fahrenheit when that is all a service sends', () => {
    expect(readCelsius({ fahrenheit: 260 })).toBeCloseTo(126.7, 1)
    expect(readCelsius({ fahrenheit: 32 })).toBe(0)
  })

  /**
   * A missing reading has to stay distinguishable from a real one so the device
   * can hold its previous value rather than publish a temperature nobody
   * measured — 0°C would read as a believable 32°F on the tile.
   */
  it.each([
    ['no state at all', undefined],
    ['an empty state', {}],
    ['a non-numeric reading', { fahrenheit: 'hot' }],
    ['a null reading', { celsiusConverted: null }],
  ])('says nothing rather than guessing for %s', (_label, state) => {
    expect(readCelsius(state as any)).toBeUndefined()
  })

  it('reads the probe climbing through a cook', () => {
    // captured a minute apart while the ribs came up to temperature
    const series = [113, 114, 116, 120, 123].map(fahrenheit => readCelsius({ fahrenheit })!)
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeGreaterThan(series[i - 1])
    }
  })
})

/**
 * HomeKit's CurrentTemperature defaults to 0-100°C, which a smoker sits above
 * for most of a cook: a 225°F grate is 107°C, so under the stock range every
 * reading pinned to 100 and the tile showed a constant 212°F. The device widens
 * the characteristic with setProps instead, and this clamp only guards the
 * widened bounds — so it should be reached by nonsense, not by real cooking.
 */
describe('fitting a smoker temperature into HomeKit', () => {
  it('passes through anything already in range', () => {
    expect(clampToHomeKitCelsius(45)).toBe(45)
    expect(clampToHomeKitCelsius(0)).toBe(0)
    expect(clampToHomeKitCelsius(100)).toBe(100)
    // 150°F probe reading, taken off the panel mid-cook
    expect(clampToHomeKitCelsius(65.55555555555556)).toBeCloseTo(65.6, 1)
  })

  it('reports a real grate temperature instead of pinning it', () => {
    // A 225°F setpoint sits at 107.2°C. Under HomeKit's stock 0-100°C range
    // this pinned to 100 and the tile read a constant 212°F all cook; the
    // widened range is the whole point of setProps on the characteristic.
    expect(clampToHomeKitCelsius(107.22222222222223)).toBeCloseTo(107.2, 1)
    // 260°F, seen during the smoke phase
    expect(clampToHomeKitCelsius(126.66666666666667)).toBeCloseTo(126.7, 1)
  })

  it('still clamps past what the appliance can physically report', () => {
    // the smoker maxes out at 300°F (149°C); anything beyond is not a reading
    expect(clampToHomeKitCelsius(999)).toBe(200)
  })

  it('clamps a probe target that would also overflow', () => {
    // the porkrib preset finishes at 190°F
    expect(clampToHomeKitCelsius(87.77777777777777)).toBeCloseTo(87.8, 1)
    // brisket and custom both target 195°F, still inside the ceiling
    expect(clampToHomeKitCelsius(90.55555555555556)).toBeCloseTo(90.6, 1)
  })

  it('keeps a below-freezing placeholder rather than flattening it to zero', () => {
    // the warm preset reports a 0°F probe default when no probe is in use;
    // -17.8°C is inside the widened range and stays distinguishable from 0
    expect(clampToHomeKitCelsius(-17.77777777777778)).toBeCloseTo(-17.8, 1)
    expect(clampToHomeKitCelsius(-999)).toBe(-50)
  })
})

/**
 * The thermostat's target is the cavity setpoint the running preset asked for,
 * read off the matching `cooking.mode.v1` service. Values below are the ones a
 * live P9SBAAS6VBB published while smoking ribs.
 */
describe('the setpoint behind the thermostat target', () => {
  const modes = new Map<string, Record<string, any>>([
    ['cloud.smarthq.domain.cooking.food.porkrib', {
      cavityTemperatureCelsiusConverted: 107.22222222222223,
      cavityTemperatureFahrenheit: 225,
    }],
    ['cloud.smarthq.domain.cooking.food.wings', {
      cavityTemperatureCelsiusConverted: 148.88888888888889,
      cavityTemperatureFahrenheit: 300,
    }],
    ['cloud.smarthq.domain.cooking.warm', {
      cavityTemperatureFahrenheit: 150, // this preset ships no converted celsius
    }],
  ])

  it('reads the setpoint of whichever preset is running', () => {
    expect(cavitySetpointCelsius('cloud.smarthq.domain.cooking.food.porkrib', modes)).toBeCloseTo(107.2, 1)
    expect(cavitySetpointCelsius('cloud.smarthq.domain.cooking.food.wings', modes)).toBeCloseTo(148.9, 1)
  })

  it('falls back to converting when a preset omits celsius', () => {
    expect(cavitySetpointCelsius('cloud.smarthq.domain.cooking.warm', modes)).toBeCloseTo(65.6, 1)
  })

  it.each([
    ['no mode is running', undefined],
    ['a mode nothing was published for', 'cloud.smarthq.domain.cooking.food.brisket'],
  ])('says nothing rather than guessing when %s', (_label, mode) => {
    expect(cavitySetpointCelsius(mode, modes)).toBeUndefined()
  })
})

/**
 * TargetTemperature is a dial rather than a readout, and the appliance only
 * accepts 170-300°F, so its range is deliberately tighter than the grate's.
 */
describe('fitting a setpoint into the thermostat dial', () => {
  it('passes through a real cooking setpoint', () => {
    expect(clampToHomeKitTarget(107.22222222222223)).toBeCloseTo(107.2, 1) // 225°F, ribs
    expect(clampToHomeKitTarget(148.88888888888889)).toBeCloseTo(148.9, 1) // 300°F, the ceiling
  })

  it('clamps anything the appliance could not have asked for', () => {
    expect(clampToHomeKitTarget(0)).toBe(70)
    expect(clampToHomeKitTarget(999)).toBe(150)
  })
})

/**
 * ⚠️ The platform tears accessories down with `control?.shutdown?.()`. This
 * cleanup was originally called `stop()`, so nothing ever called it — the push
 * subscription stayed live and the shared websocket was never released.
 */
describe('shutting a smoker down', () => {
  function makeSmoker() {
    const smoker: any = Object.create(SmartHQSmoker.prototype)
    smoker.debugLog = async () => {}
    return smoker
  }

  it('is reachable under the name the platform actually calls', () => {
    expect(typeof SmartHQSmoker.prototype.shutdown).toBe('function')
  })

  it('drops the push subscription', () => {
    const smoker = makeSmoker()
    let unsubscribed = false
    smoker.unsubscribe = () => {
      unsubscribed = true
    }

    smoker.shutdown()

    expect(unsubscribed).toBe(true)
    expect(smoker.unsubscribe).toBeUndefined()
  })

  it('cancels a pending revert so it cannot publish into a dead accessory', () => {
    const smoker = makeSmoker()
    let published = false
    smoker.publish = () => {
      published = true
    }
    smoker.revertWrite()

    smoker.shutdown()

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(published).toBe(false)
        expect(smoker.revertTimer).toBeUndefined()
        resolve()
      }, 150)
    })
  })

  it('does not fall over when there was never a subscription', () => {
    expect(() => makeSmoker().shutdown()).not.toThrow()
  })
})
