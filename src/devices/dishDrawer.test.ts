import { describe, expect, it } from 'vitest'

import {
  dishDrawerCycleStatusByte,
  dishDrawerErd,
  dishDrawerRemainingSeconds,
  dishDrawerTubForErd,
  isDishDrawerDoorOpen,
  isKnownDishDrawerCycleStatus,
} from './dishDrawer.js'

/**
 * #120: a Fisher & Paykel DishDrawer (DDD196US) came through as a single GE
 * dishwasher, whose two tiles then sat permanently "Off" and "Open".
 *
 * Everything asserted below is taken from the owner's debug log, correlated
 * against the timeline they wrote alongside it. Their times and the appliance's
 * own timestamps agree to within a second or two:
 *
 * | what they did                    | device time | erd      | value    |
 * |----------------------------------|-------------|----------|----------|
 * | 16:12:04 opened the TOP drawer   | 20:12:03    | `0x3237` | `00`     |
 * | 16:12:34 closed the TOP drawer   | 20:12:36    | `0x3237` | `01`     |
 * | 16:13:04 opened the BOTTOM drawer| 20:13:05    | `0x3037` | `00`     |
 * | 16:13:36 closed the BOTTOM drawer| 20:13:36    | `0x3037` | `01`     |
 * | 16:14:15 started ECO, BOTTOM     | 20:14:13    | `0x3007` | `00040C` |
 * |                                  | 20:14:14    | `0xD004` | `0078`   |
 * | 16:15:40 opened BOTTOM, paused   | 20:15:34    | `0x3007` | `00080C` |
 */

describe('which drawer an erd belongs to', () => {
  /**
   * The cycle the owner started in the BOTTOM drawer moved the un-offset
   * addresses, which is what pins tub 0 to the bottom drawer rather than the
   * top. The appliance declares both tubs itself, as FPA_DISHDRAWER_V1_TUB_0
   * and FPA_DISHDRAWER_V1_TUB_1.
   */
  it('puts tub 0 on the bottom drawer and tub 1 on the top', () => {
    expect(dishDrawerErd(0, 'door')).toBe('0x3037')
    expect(dishDrawerErd(1, 'door')).toBe('0x3237')
  })

  it('offsets every field by 0x200 for the top drawer', () => {
    expect(dishDrawerErd(0, 'cycleStatus')).toBe('0x3007')
    expect(dishDrawerErd(1, 'cycleStatus')).toBe('0x3207')
    expect(dishDrawerErd(0, 'cycleState')).toBe('0x300e')
    expect(dishDrawerErd(1, 'cycleState')).toBe('0x320e')
    expect(dishDrawerErd(0, 'timeRemaining')).toBe('0xd004')
    expect(dishDrawerErd(1, 'timeRemaining')).toBe('0xd204')
  })

  it.each([
    ['0x3237', 1, 'door'],
    ['0x3037', 0, 'door'],
    ['0x3007', 0, 'cycleStatus'],
    ['0xD004', 0, 'timeRemaining'], // pushes arrive upper case
    ['0x300E', 0, 'cycleState'],
  ])('routes a pushed %s to tub %i %s', (erd, tub, field) => {
    expect(dishDrawerTubForErd(erd)).toEqual({ tub, field })
  })

  it('ignores an erd that belongs to neither drawer', () => {
    // 0x3001 is the GE operating mode, which this appliance never answers
    expect(dishDrawerTubForErd('0x3001')).toBeUndefined()
  })
})

describe('reading a drawer door', () => {
  /**
   * The polarity is the OPPOSITE of the GE dishwasher handler's, which reads 1
   * as open - that is why the drawer sat permanently "Open" in the Home app,
   * having read 01 (closed) at startup. Six transitions across both drawers in
   * the log say otherwise.
   */
  it.each([
    ['00', true], // every open in the log
    ['01', false], // every close in the log
  ])('reads %s as open=%s', (raw, open) => {
    expect(isDishDrawerDoorOpen(raw)).toBe(open)
  })

  it.each([undefined, '', 'zz'])('treats an unreadable value (%s) as closed', (raw) => {
    expect(isDishDrawerDoorOpen(raw)).toBe(false)
  })
})

describe('reading a drawer cycle status', () => {
  it('reads the byte that changed when the cycle was paused', () => {
    // 00 04 0C on starting ECO, 00 08 0C when paused - byte 1 is the run state
    // and byte 2 looks like the selected cycle, unchanged across both
    expect(dishDrawerCycleStatusByte('00040C')).toBe(0x04)
    expect(dishDrawerCycleStatusByte('00080C')).toBe(0x08)
  })

  it('recognises running and paused, and nothing else', () => {
    expect(isKnownDishDrawerCycleStatus(0x04)).toBe(true)
    expect(isKnownDishDrawerCycleStatus(0x08)).toBe(true)
    // no idle value has ever been observed - an unknown byte must not be
    // silently treated as one of the two, or the tile would claim a drawer is
    // running when nobody knows that it is
    expect(isKnownDishDrawerCycleStatus(0x00)).toBe(false)
    expect(isKnownDishDrawerCycleStatus(undefined)).toBe(false)
  })

  it.each([undefined, '', '00'])('says nothing rather than guessing for %s', (raw) => {
    expect(dishDrawerCycleStatusByte(raw)).toBeUndefined()
  })
})

describe('reading the remaining cycle time', () => {
  /**
   * 0x78 is 120 and 0x77 is 119, pushed 59 seconds apart - so the value is
   * minutes. The dishwasher handler had only assumed that, with a "to be
   * confirmed against a real appliance log" note against it.
   */
  it('reads the value as minutes', () => {
    expect(dishDrawerRemainingSeconds('0078')).toBe(120 * 60)
    expect(dishDrawerRemainingSeconds('0077')).toBe(119 * 60)
  })

  it('clamps to the HomeKit maximum rather than sending an illegal value', () => {
    expect(dishDrawerRemainingSeconds('FFFF')).toBe(86400)
  })

  it.each([undefined, '', '0000', 'zz'])('reports no time remaining for %s', (raw) => {
    expect(dishDrawerRemainingSeconds(raw)).toBe(0)
  })
})
