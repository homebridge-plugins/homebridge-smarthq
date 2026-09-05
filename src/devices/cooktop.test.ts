import { describe, expect, it } from 'vitest'

import { cooktopBurners, cooktopIsOn } from './cooktop.js'

/**
 * Frames captured from a five-burner Profile induction cooktop while each
 * burner was used in turn (#125). The first byte says whether anything is on;
 * each burner then has a flag byte that gains 0x40 while lit and a power byte.
 */
describe('reading the cooktop status', () => {
  const idle = '00230023000000010001000100'
  const leftFrontOn = '01631923000000010001000100'
  const rightRearOn = '01230023000000010001004123'

  it('says whether anything is on from the first byte', () => {
    expect(cooktopIsOn(idle)).toBe(false)
    expect(cooktopIsOn(leftFrontOn)).toBe(true)
    expect(cooktopIsOn(undefined)).toBe(false)
  })

  it('picks out which burner is lit and at what power', () => {
    expect(cooktopBurners(leftFrontOn).filter(b => b.on)).toEqual([{ slot: 1, on: true, power: 0x19 }])
    expect(cooktopBurners(rightRearOn).filter(b => b.on)).toEqual([{ slot: 6, on: true, power: 0x23 }])
    expect(cooktopBurners(idle).some(b => b.on)).toBe(false)
  })

  it('does not read burners out of a payload that is too short', () => {
    expect(cooktopBurners('0123')).toEqual([])
  })
})
