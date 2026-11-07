/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * laundryNames.ts: laundry cycle and phase names, and the running-state rule.
 *
 * Pure helpers with no runtime imports, shared by the combination
 * washer/dryer class and the energy models (which name finished cycles).
 */

/**
 * Wash and dry cycle codes share the single LAUNDRY_CYCLE ERD on combo units.
 * Codes 0-34 come from the standalone washer, 128-148 from the standalone
 * dryer; the ranges don't overlap so a merged map is unambiguous.
 */
export function combinationCycleName(code: number): string {
  const cycleMap: { [key: number]: string } = {
    // Wash cycles (shared with the standalone Clothes Washer)
    0: 'Not Defined',
    1: 'Basket Clean',
    2: 'Drain And Spin',
    3: 'Quick Rinse',
    4: 'Bulky Items',
    5: 'Sanitize',
    6: 'Towels/Sheets',
    7: 'Steam Refresh',
    8: 'Normal/Mixed',
    9: 'Whites',
    10: 'Dark Colors',
    11: 'Jeans',
    12: 'Hand Wash',
    13: 'Delicates',
    14: 'Speed Wash',
    15: 'Heavy Duty',
    16: 'Allergen',
    17: 'Power Clean',
    18: 'Rinse And Spin',
    19: 'Single Item',
    20: 'Colors',
    21: 'Cold Wash',
    22: 'Water Station',
    23: 'Tub Clean',
    24: 'Casuals With Steam',
    25: 'Stain Wash',
    26: 'Deep Clean',
    27: 'Bulky Bedding',
    28: 'Normal',
    29: 'Quick Wash',
    30: 'Sanitize With Oxi',
    31: 'Self Clean',
    32: 'Towels',
    33: 'Soak',
    34: 'Wool',
    // Dry cycles (shared with the standalone Clothes Dryer)
    128: 'Cottons',
    129: 'Easy Care',
    130: 'Active Wear',
    131: 'Timed Dry',
    132: 'Dewrinkle',
    133: 'Air Fluff',
    134: 'Steam Refresh',
    135: 'Steam Dewrinkle',
    136: 'Speed Dry',
    137: 'Mixed',
    138: 'Quick Dry',
    139: 'Casuals',
    140: 'Warm Up',
    141: 'Energy Saver',
    142: 'Antibacterial',
    143: 'Rack Dry',
    144: 'Baby Care',
    145: 'Auto Dry',
    146: 'Auto Extra',
    147: 'Perm Press',
    148: 'Washer Link',
  }
  return cycleMap[code] || `Cycle ${code}`
}

/**
 * Sub-cycle (phase) codes. Wash phases use 0-8, dry phases use 128-133; again
 * disjoint, so one merged map resolves either.
 */
export function combinationSubCycleName(code: number): string {
  const subCycleMap: { [key: number]: string } = {
    // Wash phases
    0: 'None',
    1: 'Fill',
    2: 'Soak',
    3: 'Wash',
    4: 'Rinse',
    5: 'Spin',
    6: 'Drain',
    7: 'Extra Spin',
    8: 'Extra Rinse',
    // Dry phases
    128: 'Drying',
    129: 'Mist Steam',
    130: 'Cool Down',
    131: 'Extended Tumble',
    132: 'Damp',
    133: 'Air Fluff',
  }
  return subCycleMap[code] ?? ''
}

/**
 * Machine state values follow gehome's ErdMachineState: only genuinely active
 * states count as running - standby (1) and cycle complete (4) do not (#60).
 * Exported as a pure helper so the state mapping can be unit-tested.
 */
export function isLaundryRunningState(hex: string | undefined | null): boolean {
  if (!hex) {
    return false
  }
  const state = Number.parseInt(hex, 16)
  // 2 run, 3 pause, 5/6 delay run, 7 delay pause, 8 drain timeout, 10 bulk flush
  return [2, 3, 5, 6, 7, 8, 10].includes(state)
}
