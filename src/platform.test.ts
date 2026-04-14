import type { API, Logging, PlatformConfig } from 'homebridge'

import { describe, expect, it, vi, beforeEach } from 'vitest'

import { SmartHQPlatform } from './platform.js'
import { type SmartHQMatterPlatformMixin, createSmartHQMatterPlatform } from './SmartHQMatterPlatform.js'
import { createPlatformProxy } from './utils.js'

// Mock the getAccessToken module to simulate authentication failures
vi.mock('./getAccessToken.js', () => ({
  default: vi.fn(),
  refreshAccessToken: vi.fn(),
}))

// Mock axios
vi.mock('axios', () => ({
  default: {
    defaults: {
      baseURL: '',
      headers: { common: {} },
    },
    get: vi.fn(),
  },
}))

describe('SmartHQPlatform Authentication Error Handling', () => {
  let platform: SmartHQPlatform
  let mockApi: API
  let mockLog: Logging
  let mockConfig: PlatformConfig

  beforeEach(() => {
    mockLog = {
      prefix: 'SmartHQ',
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logging

    mockApi = {
      hap: {
        Service: {},
        Characteristic: {},
        uuid: {
          generate: vi.fn().mockReturnValue('test-uuid'),
        },
      },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
    } as unknown as API

    mockConfig = {
      platform: 'SmartHQ',
      name: 'SmartHQ',
      credentials: {
        username: 'test@example.com',
        password: 'testpassword',
      },
    }

    platform = new SmartHQPlatform(mockLog, mockConfig, mockApi)
  })

  it('should handle getAccessToken failure gracefully', async () => {
    const getAccessToken = await import('./getAccessToken.js')
    const mockGetAccessToken = vi.mocked(getAccessToken.default)
    
    // Simulate getAccessToken throwing "Invalid URL" error
    mockGetAccessToken.mockRejectedValue(new Error('Invalid URL'))

    // Spy on platform error logging
    const errorLogSpy = vi.spyOn(platform as any, 'errorLog').mockResolvedValue(undefined)

    // Call discoverDevices and expect it to handle the error gracefully
    await platform.discoverDevices()

    // Verify error was logged
    expect(errorLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('discoverDevices, Failed to get Access Token, Error Message: Invalid URL')
    )

    // Verify execution stopped (no further errors logged)
    expect(errorLogSpy).toHaveBeenCalledTimes(1)
  })

  it('should handle missing credentials gracefully', async () => {
    // Configure platform with missing credentials
    const configWithoutCredentials = {
      ...mockConfig,
      credentials: undefined,
    }
    
    const platformWithoutCreds = new SmartHQPlatform(mockLog, configWithoutCredentials, mockApi)
    const errorLogSpy = vi.spyOn(platformWithoutCreds as any, 'errorLog').mockResolvedValue(undefined)

    await platformWithoutCreds.discoverDevices()

    expect(errorLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Username or password is undefined')
    )
  })
})

describe('SmartHQMatterPlatform Matter Support', () => {
  let mockLog: Logging
  let mockConfig: PlatformConfig
  let SmartHQMatterPlatform: ReturnType<typeof createSmartHQMatterPlatform>

  beforeEach(() => {
    SmartHQMatterPlatform = createSmartHQMatterPlatform(SmartHQPlatform)

    mockLog = {
      prefix: 'SmartHQ',
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logging

    mockConfig = {
      platform: 'SmartHQ',
      name: 'SmartHQ',
      credentials: {
        username: 'test@example.com',
        password: 'testpassword',
      },
    }
  })

  it('should initialize matterAccessories as an empty Map', () => {
    const mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn() } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
    } as unknown as API

    const platform = new SmartHQMatterPlatform(mockLog, mockConfig, mockApi)
    expect(platform.matterAccessories).toBeInstanceOf(Map)
    expect(platform.matterAccessories.size).toBe(0)
  })

  it('should store Matter accessory in configureMatterAccessory', () => {
    const mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn() } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
    } as unknown as API

    const platform = new SmartHQMatterPlatform(mockLog, mockConfig, mockApi)
    const mockMatterAccessory = { UUID: 'matter-uuid-1', displayName: 'Test Matter Accessory' }

    platform.configureMatterAccessory(mockMatterAccessory)

    expect(platform.matterAccessories.has('matter-uuid-1')).toBe(true)
    expect(platform.matterAccessories.get('matter-uuid-1')).toBe(mockMatterAccessory)
  })

  it('should populate HAP accessories cache when configureAccessory is called', () => {
    const mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn() } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
    } as unknown as API

    const platform = new SmartHQMatterPlatform(mockLog, mockConfig, mockApi)
    const mockAccessory = { UUID: 'hap-uuid-1', displayName: 'Test HAP Accessory', context: {} }

    platform.configureAccessory(mockAccessory as any)

    expect(platform.accessories.some(a => a.UUID === 'hap-uuid-1')).toBe(true)
  })

  it('should log info when disableMatter is true', () => {
    const mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn() } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
    } as unknown as API

    const configWithDisableMatter = {
      ...mockConfig,
      options: { disableMatter: true, logging: 'standard' },
    }

    const platform = new SmartHQMatterPlatform(mockLog, configWithDisableMatter, mockApi)
    const infoLogSpy = vi.spyOn(platform as any, 'infoLog').mockResolvedValue(undefined)
    platform.checkMatterAvailability()

    expect(infoLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Matter support is disabled by plugin configuration'),
    )
  })

  it('should log debug when Matter is not available (older Homebridge)', () => {
    const mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn() } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
      // isMatterAvailable is absent (older Homebridge)
    } as unknown as API

    const platform = new SmartHQMatterPlatform(mockLog, mockConfig, mockApi)
    const debugLogSpy = vi.spyOn(platform as any, 'debugLog').mockResolvedValue(undefined)
    platform.checkMatterAvailability()

    expect(debugLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Matter is not available'),
    )
  })

  it('should log warn when Matter is available but not enabled', () => {
    const mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn() } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
      isMatterAvailable: vi.fn().mockReturnValue(true),
      isMatterEnabled: vi.fn().mockReturnValue(false),
    } as unknown as API

    const platform = new SmartHQMatterPlatform(mockLog, mockConfig, mockApi)
    const warnLogSpy = vi.spyOn(platform as any, 'warnLog').mockResolvedValue(undefined)
    platform.checkMatterAvailability()

    expect(warnLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Matter is available but not enabled'),
    )
  })

  it('should log info when Matter is available and enabled', () => {
    const mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn() } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
      isMatterAvailable: vi.fn().mockReturnValue(true),
      isMatterEnabled: vi.fn().mockReturnValue(true),
    } as unknown as API

    const platform = new SmartHQMatterPlatform(mockLog, mockConfig, mockApi)
    const infoLogSpy = vi.spyOn(platform as any, 'infoLog').mockResolvedValue(undefined)
    platform.checkMatterAvailability()

    expect(infoLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Matter is available and enabled'),
    )
  })
})

describe('createPlatformProxy', () => {
  let mockLog: Logging
  let mockConfig: PlatformConfig
  let SmartHQMatterPlatform: ReturnType<typeof createSmartHQMatterPlatform>

  beforeEach(() => {
    SmartHQMatterPlatform = createSmartHQMatterPlatform(SmartHQPlatform)

    mockLog = {
      prefix: 'SmartHQ',
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logging

    mockConfig = {
      platform: 'SmartHQ',
      name: 'SmartHQ',
      credentials: {
        username: 'test@example.com',
        password: 'testpassword',
      },
    }
  })

  it('should instantiate the HAP platform when Matter is not available', () => {
    const mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn() } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
      // no isMatterAvailable — simulates Homebridge < 2.0
    } as unknown as API

    const ProxyCtor = createPlatformProxy(SmartHQPlatform, SmartHQMatterPlatform)
    const instance = new ProxyCtor(mockLog, mockConfig, mockApi)
    expect(instance).toBeInstanceOf(SmartHQPlatform)
    expect(instance).not.toBeInstanceOf(SmartHQMatterPlatform)
  })

  it('should instantiate the Matter platform when Matter is available and enabled', () => {
    const mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn() } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
      isMatterAvailable: vi.fn().mockReturnValue(true),
      isMatterEnabled: vi.fn().mockReturnValue(true),
    } as unknown as API

    const ProxyCtor = createPlatformProxy(SmartHQPlatform, SmartHQMatterPlatform)
    const instance = new ProxyCtor(mockLog, mockConfig, mockApi)
    expect(instance).toBeInstanceOf(SmartHQMatterPlatform)
  })

  it('should fall back to HAP when disableMatter is true even if Matter is available', () => {
    const mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn() } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
      isMatterAvailable: vi.fn().mockReturnValue(true),
      isMatterEnabled: vi.fn().mockReturnValue(true),
    } as unknown as API

    const configWithDisableMatter = {
      ...mockConfig,
      options: { disableMatter: true },
    }

    const ProxyCtor = createPlatformProxy(SmartHQPlatform, SmartHQMatterPlatform)
    const instance = new ProxyCtor(mockLog, configWithDisableMatter, mockApi)
    expect(instance).toBeInstanceOf(SmartHQPlatform)
    expect(instance).not.toBeInstanceOf(SmartHQMatterPlatform)
  })

  it('should fall back to HAP when Matter is available but not enabled', () => {
    const mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn() } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
      isMatterAvailable: vi.fn().mockReturnValue(true),
      isMatterEnabled: vi.fn().mockReturnValue(false),
    } as unknown as API

    const ProxyCtor = createPlatformProxy(SmartHQPlatform, SmartHQMatterPlatform)
    const instance = new ProxyCtor(mockLog, mockConfig, mockApi)
    expect(instance).toBeInstanceOf(SmartHQPlatform)
    expect(instance).not.toBeInstanceOf(SmartHQMatterPlatform)
  })
})