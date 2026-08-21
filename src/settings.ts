/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * settings.ts: @homebridge-plugins/homebridge-smarthq.
 */
import type { PlatformConfig } from 'homebridge'

import pkg from 'lodash'

const { invert } = pkg

/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'SmartHQ'

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = '@homebridge-plugins/homebridge-smarthq'

/**
 * This is the Login URL for the SmartHQ API
 */
export const LOGIN_URL = 'https://accounts.brillion.geappliances.com/'

/**
 * This is the Secure URL for the SmartHQ API
 */
export const SECURE_URL = 'https://secure.brillion.geappliances.com'

// Config
export interface SmartHQPlatformConfig extends PlatformConfig {
  name?: string
  credentials?: credentials
  devices?: devicesConfig[]
  options?: options
  deviceOptions?: DeviceOptions
}

export interface credentials {
  username?: string
  password?: string
  mfaCode?: string
}

export interface devicesConfig {
  applianceId?: string
  /**
   * Overrides the serial number shown in HomeKit. The SmartHQ cloud does not
   * hold one for every appliance, and reports the literal string `Unknown`
   * when it does not.
   */
  serialNumber?: string
  firmware: string
  refreshRate?: number
  logging?: string
  hide_device?: boolean
  useMatter?: boolean // Enable/disable Matter for this specific device
  matterOnly?: boolean // If true, do not fall back to HAP when Matter is unavailable
  defaultOperationMode?: 'cool' | 'fanOnly' | 'energySaver' | 'heat' | 'dry' // AC only: mode applied when the AC service is switched on
  createSeparateFanService?: boolean // AC only: expose a separate fan service for fan-speed control
  showDryModeSwitch?: boolean // AC only: expose the dry mode switch
  showHeatMode?: boolean // AC only: expose heat in the target mode dropdown and as a mode switch
  showModeSwitches?: boolean // AC only: expose the individual mode switches; disable for a minimal tile of just the mode selector and fan
  // Oven only: one switch per cooking mode, each off by default so an existing
  // accessory gains no new tiles until the user asks for them (#111). The mode
  // bytes behind these were read off a real oven — see OVEN_COOK_MODES.
  showBakeSwitch?: boolean
  showConvBakeMultiSwitch?: boolean
  showConvRoastSwitch?: boolean
  showAirFrySwitch?: boolean
  showRunningSwitch?: boolean // laundry only: expose a read-only switch that mirrors whether the machine is running
  showFilterBattery?: boolean // water filter only: expose the filter life as a battery so the percentage is glanceable in HomeKit
  keurig?: boolean // Override auto-detect for the built-in Keurig K-Cup brewer (e.g. PYE22PYNHFS)
  keurigOnly?: boolean // Skip the main Refrigerator accessory; only publish the Keurig sub-accessory
}

// --- Keurig (in-fridge K-Cup brewer) types ---
// Decoding of HOT_WATER_STATUS (0x1010) follows simbaja/gehome — see
// gehomesdk/erd/converters/fridge/hot_water_status_converter.py
// Research notes are attached to the pull request (#95).
export type ErdHotWaterStatusValue
  = | 'NOT_HEATING'
    | 'HEATING'
    | 'READY'
    | 'FAULT_NEED_CLEARED'
    | 'FAULT_LOCKED_OUT'
    | 'NA'

export type ErdPodStatusValue = 'REPLACE' | 'READY' | 'NA'

export interface HotWaterStatus {
  status: ErdHotWaterStatusValue
  timeUntilReadyMinutes: number | null
  currentTempF: number | null
  tankFull: boolean | null
  brewModulePresent: boolean | null
  podStatus: ErdPodStatusValue
  faulted: boolean
}

export interface options {
  allowInvalidCharacters?: boolean
  region?: string // Explicit SmartHQ account region (e.g. 'us' or 'eu') for the login flow
  refreshRate?: number
  logging?: string
  homekitControllerNotificationsSecret?: string
}

interface OpalOptions {
  opalProductionLimit?: number
  oplHKCIceBucketFullNotificationPath?: string
  oplHKCProgressCompleteNotificationPath?: string
  oplHKCFilterMaintenanceNotificationPath?: string
  oplHKCAddWaterNotificationPath?: string
  oplHKCDescaleNotificationPath?: string
  oplAutoShutoffOnBlockingEvent?: boolean
  oplIceProductionSchedule?: {
    Monday: {
      time: string
      enabled: boolean
    }
    Tuesday: {
      time: string
      enabled: boolean
    }
    Wednesday: {
      time: string
      enabled: boolean
    }
    Thursday: {
      time: string
      enabled: boolean
    }
    Friday: {
      time: string
      enabled: boolean
    }
    Saturday: {
      time: string
      enabled: boolean
    }
    Sunday: {
      time: string
      enabled: boolean
    }
  }
}
export interface DeviceOptions {
  opal?: OpalOptions
}

export interface SmartHqContext {
  userId: string
  device: {
    jid: string
    brand: string
    model: string
    serial: string
    nickname: string
    applianceId: string
    firmware: string
    features: string[]
  }
  // Cached device states
  DishWasher?: {
    Service?: any
    Name?: any
    On?: any
  }
  ClothesWasher?: {
    On?: any
  }
  ClothesDryer?: {
    On?: any
  }
}

export interface SmartHqERDResponse {
  kind: string
  userId: string
  applianceId: string
  erd: string
  value: string
  time: string
}

// Constants
export const OAUTH2_CLIENT_ID = '564c31616c4f7474434b307435412b4d2f6e7672'
export const OAUTH2_CLIENT_SECRET = '6476512b5246446d452f697154444941387052645938466e5671746e5847593d'
export const OAUTH2_REDIRECT_URI = 'brillion.4e617a766474657344444e562b5935566e51324a://oauth/redirect'
export const API_URL = 'https://api.brillion.geappliances.com/v1/'
export const KEEPALIVE_TIMEOUT = 30 * 1000

/**
 * ⚠️ Axios defaults to no timeout at all, so a connection that opens and then
 * stops responding waits forever rather than failing - one stalled read holds a
 * poll open indefinitely. Generous enough that a slow-but-working API is never
 * cut off, short enough that a dead socket is given up on and retried.
 */
export const API_TIMEOUT_MS = 20 * 1000

export const ERD_TYPES = {
  APPLIANCE_TYPE: '0x0008' as const,
  CLOCK_FORMAT: '0x0006' as const,
  CLOCK_TIME: '0x0005' as const,
  MODEL_NUMBER: '0x0001' as const,
  SABBATH_MODE: '0x0009' as const,
  SERIAL_NUMBER: '0x0002' as const,
  SOUND_LEVEL: '0x000a' as const,
  TEMPERATURE_UNIT: '0x0007' as const,
  USER_INTERFACE_LOCKED: '0x0004' as const,
  UNIT_TYPE: '0x0035' as const,
  /**
   * Water heater temperatures, both in TENTHS of a degree in whatever unit the
   * appliance displays. Read off a GE50S10BLM01 in #117: setting 125 on the
   * panel published 0x4024 = 04E2 (1250) and setting it back to 120 published
   * 04B0 (1200), while 0x4026 followed the tank down to 0481 (115.3) and back.
   */
  WATER_HEATER_TARGET_TEMPERATURE: '0x4024' as const,
  WATER_HEATER_CURRENT_TEMPERATURE: '0x4026' as const,
  /**
   * Water heater operating mode. A GE50S10BLM01 offers only two on its panel
   * and in the SmartHQ app, and reported them plainly in #117: `01` while set
   * to Normal, `04` while set to Vacation.
   */
  WATER_HEATER_MODE: '0x4020' as const,

  WIFI_MODULE_UPDATING: '0x0099' as const,
  WIFI_MODULE_SW_VERSION: '0x0100' as const,
  WIFI_MODULE_SW_VERSION_AVAILABLE: '0x0101' as const,
  ACM_UPDATING: '0x0102' as const,
  APPLIANCE_SW_VERSION: '0x0103' as const,
  APPLIANCE_SW_VERSION_AVAILABLE: '0x0104' as const,
  APPLIANCE_UPDATING: '0x0105' as const,
  LCD_SW_VERSION: '0x0106' as const,
  LCD_SW_VERSION_AVAILABLE: '0x0107' as const,
  LCD_UPDATING: '0x0108' as const,

  // Ice Maker
  OIM_STATUS: '0x9100',
  OIM_LIGHT_LEVEL: '0x9101',
  OIM_UNKNOWN9102: '0x9102',
  OIM_FILTER_STATUS: '0x9104',
  OIM_NEEDS_DESCALING: '0x9106',
  OIM_POWER: '0x9107',
  OIM_PRODUCTION: '0x9108',

  AIR_FILTER_STATUS: '0x101c' as const,
  DOOR_STATUS: '0x1016' as const,
  FRIDGE_MODEL_INFO: '0x101d' as const,
  HOT_WATER_IN_USE: '0x1018' as const,
  HOT_WATER_SET_TEMP: '0x1011' as const,
  HOT_WATER_STATUS: '0x1010' as const,
  ICE_MAKER_BUCKET_STATUS: '0x1007' as const,
  ICE_MAKER_CONTROL: '0x100a' as const,
  SETPOINT_LIMITS: '0x100b' as const,
  CURRENT_TEMPERATURE: '0x1004' as const,
  TEMPERATURE_SETTING: '0x1005' as const,
  TURBO_COOL_STATUS: '0x100f' as const,
  TURBO_FREEZE_STATUS: '0x100e' as const,
  WATER_FILTER_STATUS: '0x1009' as const,
  // Whole-home water filter codes follow simbaja/gehome's erd_codes.py (#10)
  WATER_FILTER_VALVE_STATE: '0x115e' as const,
  WATER_FILTER_MODE: '0x115f' as const,
  WATER_FILTER_FLOW_RATE: '0x1160' as const,
  WATER_FILTER_LIFE_REMAINING: '0x1164' as const,
  WATER_FILTER_FLOW_ALERT: '0x1169' as const,
  WATER_FILTER_LEAK_VALIDITY: '0x116e' as const,
  FRIDGE_UNKNOWN_1012: '0x1012' as const,
  FRIDGE_UNKNOWN_1013: '0x1013' as const,
  FRIDGE_UNKNOWN_1019: '0x1019' as const,
  CONVERTABLE_DRAWER_MODE: '0x1020' as const,
  INTERIOR_LIGHT: '0x1024' as const,
  PROXIMITY_LIGHT: '0x1028' as const,
  FRIDGE_UNKONWN_1029: '0x1029' as const,
  LOCKOUT_MODE: '0x102c' as const,
  DISPLAY_MODE: '0x102d' as const,
  FRIDGE_UNKNOWN_102E: '0x102e' as const,
  FRIDGE_UNKNOWN_1100: '0x1100' as const,
  FRIDGE_UNKNOWN_1101: '0x1101' as const,
  FRIDGE_UNKNOWN_1102: '0x1102' as const,
  FRIDGE_UNKNOWN_1103: '0x1103' as const,
  FRIDGE_UNKNOWN_1104: '0x1104' as const,
  ACTIVE_F_CODE_STATUS: '0x5005' as const,
  CONVECTION_CONVERSION: '0x5003' as const,
  ELAPSED_ON_TIME: '0x5004' as const,
  END_TONE: '0x5001' as const,
  HOUR_12_SHUTOFF_ENABLED: '0x5000' as const,
  KEY_PRESSED: '0x5006' as const,
  LIGHT_BAR: '0x5002' as const,
  LOWER_OVEN_AVAILABLE_COOK_MODES: '0x520b' as const,
  LOWER_OVEN_EXTENDED_COOK_MODES: '0x5213' as const,
  LOWER_OVEN_COOK_MODE: '0x5200' as const,
  LOWER_OVEN_COOK_TIME_REMAINING: '0x5204' as const,
  LOWER_OVEN_CURRENT_STATE: '0x5201' as const,
  LOWER_OVEN_DELAY_TIME_REMAINING: '0x5202' as const,
  LOWER_OVEN_DISPLAY_TEMPERATURE: '0x5209' as const,
  LOWER_OVEN_ELAPSED_COOK_TIME: '0x5208' as const,
  LOWER_OVEN_KITCHEN_TIMER: '0x5205' as const,
  LOWER_OVEN_PROBE_DISPLAY_TEMP: '0x5203' as const,
  LOWER_OVEN_PROBE_PRESENT: '0x5207' as const,
  LOWER_OVEN_REMOTE_ENABLED: '0x520a' as const,
  LOWER_OVEN_USER_TEMP_OFFSET: '0x5206' as const,
  LOWER_OVEN_WARMING_DRAWER_STATE: '0x520c' as const,
  LOWER_OVEN_RAW_TEMPERATURE: '0x520d' as const,
  LOWER_OVEN_LIGHT: '0x5211' as const,
  LOWER_OVEN_LIGHT_AVAILABILITY: '0x5212' as const,
  OVEN_CONFIGURATION: '0x5007' as const,
  OVEN_MODE_MIN_MAX_TEMP: '0x5008' as const,
  UPPER_OVEN_AVAILABLE_COOK_MODES: '0x510b' as const,
  UPPER_OVEN_EXTENDED_COOK_MODES: '0x5113' as const,
  UPPER_OVEN_COOK_MODE: '0x5100' as const,
  UPPER_OVEN_COOK_TIME_REMAINING: '0x5104' as const,
  UPPER_OVEN_CURRENT_STATE: '0x5101' as const,
  UPPER_OVEN_DELAY_TIME_REMAINING: '0x5102' as const,
  UPPER_OVEN_DISPLAY_TEMPERATURE: '0x5109' as const,
  UPPER_OVEN_ELAPSED_COOK_TIME: '0x5108' as const,
  UPPER_OVEN_KITCHEN_TIMER: '0x5105' as const,
  UPPER_OVEN_PROBE_DISPLAY_TEMP: '0x5103' as const,
  UPPER_OVEN_PROBE_PRESENT: '0x5107' as const,
  UPPER_OVEN_REMOTE_ENABLED: '0x510a' as const,
  UPPER_OVEN_USER_TEMP_OFFSET: '0x5106' as const,
  UPPER_OVEN_WARMING_DRAWER_STATE: '0x510c' as const,
  UPPER_OVEN_RAW_TEMPERATURE: '0x510d' as const,
  UPPER_OVEN_LIGHT: '0x5111' as const,
  UPPER_OVEN_LIGHT_AVAILABILITY: '0x5112' as const,
  WARMING_DRAWER_STATE: '0x5009' as const,

  COOKTOP_CONFIG: '0x551c' as const,
  COOKTOP_STATUS: '0x5520' as const,

  PRECISION_COOKING_PROBE_CONTROL_MODE: '0x5670' as const,
  PRECISION_COOKING_PROBE_STATUS: '0x5671' as const,
  PRECISION_COOKING_PROBE_TEMP_TARGET: '0x5672' as const,
  PRECISION_COOKING_PROBE_TEMP_CURRENT: '0x5673' as const,
  PRECISION_COOKING_PROBE_TIME_TARGET: '0x5674' as const,
  PRECISION_COOKING_START_SOUS_VIDE_TIMER_ACTIVE_STATUS: '0x5675' as const,
  PRECISION_COOKING_PROBE_TIME_CURRENT: '0x5676' as const,
  PRECISION_COOKING_PROBE_TARGET_TIME_REACHED: '0x5677' as const,
  PRECISION_COOKING_PROBE_BATTERY_STATUS: '0x5678' as const,

  CLOSED_LOOP_COOKING_CONFIGURATION: '0x5770' as const,

  DISHWASHER_CYCLE: '0x6000' as const,
  DISHWASHER_OPERATING_MODE: '0x3001' as const,
  DISHWASHER_CYCLE_STATE: '0x300e' as const,
  DISHWASHER_TIME_REMAINING: '0xd004' as const,
  DISHWASHER_DOOR_STATUS: '0x3037' as const,
  DISHWASHER_CYCLE_PHASE: '0x6001' as const,
  DISHWASHER_CYCLE_PHASE_DESCRIPTION: '0x6002' as const,
  DISHWASHER_CYCLE_PHASE_TIME_REMAINING: '0x6003' as const,
  DISHWASHER_CYCLE_PHASE_STATUS: '0x6004' as const,
  DISHWASHER_CYCLE_PHASE_STATUS_DESCRIPTION: '0x6005' as const,
  DISHWASHER_CYCLE_PHASE_STATUS_TIME_REMAINING: '0x6006' as const,
  DISHWASHER_CYCLE_PHASE_STATUS_TIME_TOTAL: '0x6007' as const,
  COMMON_V1_CONTROL_LOCK: '0x7000' as const,
  COMMON_V1_SABBATH: '0x7001' as const,
  COMMON_V1_SOUND_LEVEL: '0x7002' as const,
  DISHWASHER_V1_CYCLE_DEFINITIONS: '0x7003' as const,
  DISHWASHER_V1_CYCLE_SETTINGS_BOTTLE_BLAST_OPTION: '0x7004' as const,
  DISHWASHER_V1_CYCLE_SETTINGS_DELAY_START: '0x7005' as const,
  DISHWASHER_V1_CYCLE_SETTINGS_DRY_TEMP_SELECTION: '0x7006' as const,
  DISHWASHER_V1_CYCLE_SETTINGS_SELECTED_CYCLE: '0x7007' as const,
  DISHWASHER_V1_CYCLE_SETTINGS_STEAM_OPTION: '0x7008' as const,
  DISHWASHER_V1_CYCLE_SETTINGS_WASH_TEMP_SELECTION: '0x7009' as const,
  DISHWASHER_V1_CYCLE_SETTINGS_WASH_ZONE_SELECTION: '0x700a' as const,
  DISHWASHER_V1_FOUNDATION: '0x700b' as const,
  DISHWASHER_V1_REMAINING_DELAY_START_TIME: '0x700c' as const,
  DISHWASHER_V1_REMOTE_CYCLE_CONTROL: '0x700d' as const,
  DISHWASHER_V1_SERVICE: '0x700e' as const,
  DISHWASHER_V2_SMART_ASSIST: '0x700f' as const,
  RESOURCE_MANAGEMENT_V1_ELECTRICAL_ENERGY_USAGE_V2: '0x7010' as const,

  // Laundry (Washer/Dryer)
  // Laundry codes follow simbaja/gehome's erd_codes.py — the previous sequential
  // guesses polled the wrong ERDs (#60: door lock read 0x200a, which is the cycle)
  LAUNDRY_MACHINE_STATE: '0x2000' as const,
  LAUNDRY_CYCLE: '0x200a' as const,
  LAUNDRY_SUB_CYCLE: '0x2001' as const,
  LAUNDRY_END_OF_CYCLE: '0x2002' as const,
  LAUNDRY_TIME_REMAINING: '0x2007' as const,
  LAUNDRY_DELAY_TIME_REMAINING: '0x2010' as const,
  LAUNDRY_DOOR: '0x2012' as const,
  LAUNDRY_DOOR_LOCK: '0x2013' as const,
  LAUNDRY_REMOTE_STATUS: '0x2039' as const,

  // Air Conditioner
  AIR_CONDITIONER_AMBIENT_TEMPERATURE: '0x7A02' as const,
  AIR_CONDITIONER_FAN_SETTING: '0x7A00' as const,
  AIR_CONDITIONER_FILTER_STATUS: '0x7A04' as const,
  AIR_CONDITIONER_OPERATION_MODE: '0x7A01' as const,
  AIR_CONDITIONER_POWER_STATUS: '0x7A0F' as const,
  AIR_CONDITIONER_SWING_MODE: '0x7A03' as const,
  AIR_CONDITIONER_TARGET_TEMPERATURE: '0x7003' as const,
  AIR_CONDITIONER_TEMPERATURE_UNIT: '0x0007' as const,

  // Hood/Range Vent
  HOOD_FAN_SPEED: '0x5B00' as const,
  HOOD_LIGHT_LEVEL: '0x5B02' as const,
}

export const ERD_CODES = invert(ERD_TYPES)
// export const ERD_CODES = Object.fromEntries(Object.entries(ERD_TYPES).map(([key, value]) => [value, key]))

/**
 * ERD codes are hex, and both this file and the API are inconsistent about
 * the case of the letters in them (0x116e here, 0x116D over the websocket).
 * Normalise before comparing or a lookup silently misses.
 */
export function normaliseErd(erd: string): string {
  return erd.toLowerCase()
}

const ERD_CODES_BY_NORMALISED: Record<string, string> = Object.fromEntries(
  Object.entries(ERD_CODES).map(([code, name]) => [normaliseErd(code), name as string]),
)

/**
 * Look up the friendly name of an ERD code, whatever case it arrives in.
 */
export function lookupErdName(erd: string): string | undefined {
  return ERD_CODES_BY_NORMALISED[normaliseErd(erd)]
}

/**
 * The largest delay a Node timer can hold, because it is stored in a signed
 * 32-bit integer. Roughly 24.85 days.
 */
export const MAX_TIMER_MS = 2147483647

/**
 * Keep a computed delay inside the range a Node timer can represent.
 *
 * Going over the limit does not throw. Node prints a TimeoutOverflowWarning and
 * quietly sets the delay to 1 ms, so a timer meant to fire in weeks fires a
 * thousand times a second instead - which for a polling loop means hammering
 * the service it polls.
 *
 * Clamping means a delay longer than 24.85 days simply fires at 24.85 days,
 * which for every setting here is early rather than wrong.
 */
export function safeTimerMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 1
  }
  return Math.min(Math.floor(ms), MAX_TIMER_MS)
}
