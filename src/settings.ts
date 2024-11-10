/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * settings.ts: @homebridge-plugins/homebridge-smarthq.
 */
import { Characteristic, type PlatformConfig } from 'homebridge'
import { invert } from 'lodash'

/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'SmartHQ'

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = '@homebridge-plugins/homebridge-smarthq'

// Config
export interface SmartHQPlatformConfig extends PlatformConfig {
  name?: string
  credentials?: credentials
  devices?: devicesConfig[]
  options?: options
}

export interface credentials {
  username?: string
  password?: string
}

export interface devicesConfig {
  firmware: string
  refreshRate?: number
  updateRate?: number
  pushRate?: number
  logging?: string
  hide_device?: boolean
}

export interface options {
  allowInvalidCharacters?: boolean
  refreshRate?: number
  updateRate?: number
  pushRate?: number
  logging?: string
}

// Constants
export const OAUTH2_CLIENT_ID = '564c31616c4f7474434b307435412b4d2f6e7672'
export const OAUTH2_CLIENT_SECRET = '6476512b5246446d452f697154444941387052645938466e5671746e5847593d'
export const OAUTH2_REDIRECT_URI = 'brillion.4e617a766474657344444e562b5935566e51324a://oauth/redirect'
export const API_URL = 'https://api.brillion.geappliances.com/v1/'
export const KEEPALIVE_TIMEOUT = 30 * 1000

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
}

export const ERD_CODES = invert(ERD_TYPES)
// export const ERD_CODES = Object.fromEntries(Object.entries(ERD_TYPES).map(([key, value]) => [value, key]))
