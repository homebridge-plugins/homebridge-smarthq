import { describe, expect, it } from 'vitest'

import { combinationCycleName, combinationSubCycleName, isLaundryRunningState } from './combinationWasherDryer.js'

describe('combinationCycleName', () => {
  it('resolves wash cycle codes (shared with the standalone washer)', () => {
    expect(combinationCycleName(0)).toBe('Not Defined')
    expect(combinationCycleName(28)).toBe('Normal')
    expect(combinationCycleName(15)).toBe('Heavy Duty')
    expect(combinationCycleName(34)).toBe('Wool')
  })

  it('resolves dry cycle codes (shared with the standalone dryer)', () => {
    expect(combinationCycleName(128)).toBe('Cottons')
    expect(combinationCycleName(145)).toBe('Auto Dry')
    expect(combinationCycleName(148)).toBe('Washer Link')
  })

  it('falls back to a generic label for unknown codes', () => {
    expect(combinationCycleName(200)).toBe('Cycle 200')
  })
})

describe('combinationSubCycleName', () => {
  it('resolves wash phases', () => {
    expect(combinationSubCycleName(0)).toBe('None')
    expect(combinationSubCycleName(3)).toBe('Wash')
    expect(combinationSubCycleName(5)).toBe('Spin')
  })

  it('resolves dry phases', () => {
    expect(combinationSubCycleName(128)).toBe('Drying')
    expect(combinationSubCycleName(130)).toBe('Cool Down')
  })

  it('returns an empty string for unknown phases', () => {
    expect(combinationSubCycleName(250)).toBe('')
  })
})

describe('isLaundryRunningState', () => {
  it('treats genuinely active states as running', () => {
    // 2 run, 3 pause, 5/6 delay run, 7 delay pause, 8 drain timeout, 10 (0x0a) bulk flush
    for (const hex of ['02', '03', '05', '06', '07', '08', '0a']) {
      expect(isLaundryRunningState(hex)).toBe(true)
    }
  })

  it('treats standby (1) and cycle complete (4) as not running (#60)', () => {
    expect(isLaundryRunningState('01')).toBe(false)
    expect(isLaundryRunningState('04')).toBe(false)
  })

  it('returns false for missing/empty readings', () => {
    expect(isLaundryRunningState(undefined)).toBe(false)
    expect(isLaundryRunningState(null)).toBe(false)
    expect(isLaundryRunningState('')).toBe(false)
  })
})
