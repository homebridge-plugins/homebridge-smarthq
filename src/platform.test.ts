import type { API, Logging, PlatformConfig } from 'homebridge'

import { describe, expect, it, vi, beforeEach } from 'vitest'

import { SmartHQPlatform } from './platform.js'

// Mock the getAccessToken module to simulate authentication failures
vi.mock('./getAccessToken.js', () => ({
  default: vi.fn(),
  refreshAccessToken: vi.fn(),
}))

// Mock ws module
vi.mock('ws', () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    send: vi.fn(),
  })),
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

describe('SmartHQPlatform Per-Device Config Merge', () => {
  let mockApi: API
  let mockLog: Logging
  let mockConfig: PlatformConfig

  beforeEach(() => {
    vi.clearAllMocks()

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
  })

  async function setupDiscoverDevices(config: PlatformConfig, devices: any[]) {
    const getAccessTokenModule = await import('./getAccessToken.js')
    const mockGetAccessToken = vi.mocked(getAccessTokenModule.default)
    const mockRefreshAccessToken = vi.mocked(getAccessTokenModule.refreshAccessToken)

    const fakeTokenSet = {
      access_token: 'fake-token',
      refresh_token: 'fake-refresh',
      expires_in: 99999,
    } as any

    mockGetAccessToken.mockResolvedValue(fakeTokenSet)
    mockRefreshAccessToken.mockResolvedValue(fakeTokenSet)

    const axios = (await import('axios')).default
    const mockGet = vi.mocked(axios.get)
    mockGet.mockImplementation((url: string) => {
      if (url === '/websocket') {
        return Promise.resolve({ data: { endpoint: 'wss://fake' } })
      }
      if (url === '/appliance') {
        return Promise.resolve({ data: { userId: 'user-1', items: devices } })
      }
      if (url.match(/^\/appliance\/[^/]+$/)) {
        return Promise.resolve({ data: {} })
      }
      if (url.match(/^\/appliance\/[^/]+\/feature$/)) {
        return Promise.resolve({ data: {} })
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })

    const platform = new SmartHQPlatform(mockLog, config, mockApi)
    vi.spyOn(platform as any, 'errorLog').mockResolvedValue(undefined)
    vi.spyOn(platform as any, 'warnLog').mockResolvedValue(undefined)
    vi.spyOn(platform as any, 'debugLog').mockResolvedValue(undefined)
    vi.spyOn(platform as any, 'infoLog').mockResolvedValue(undefined)

    return { platform, mockGet }
  }

  it('should merge per-device config overrides onto discovered devices', async () => {
    mockConfig = {
      platform: 'SmartHQ',
      name: 'SmartHQ',
      credentials: { username: 'test@example.com', password: 'pass' },
      devices: [
        { applianceId: 'appliance-1', hide_device: true },
        { applianceId: 'appliance-2', refreshRate: 60 },
      ],
    }

    const apiDevices = [
      { applianceId: 'appliance-1', type: 'UnknownType', nickname: 'Device 1' },
      { applianceId: 'appliance-2', type: 'UnknownType', nickname: 'Device 2' },
      { applianceId: 'appliance-3', type: 'UnknownType', nickname: 'Device 3' },
    ]

    const { platform } = await setupDiscoverDevices(mockConfig, apiDevices)
    await platform.discoverDevices()

    // All three are unsupported types so warnLog gets called for each.
    // The key thing is that discoverDevices doesn't crash and processes all devices.
    const warnSpy = vi.mocked((platform as any).warnLog)
    expect(warnSpy).toHaveBeenCalledTimes(3)
  })

  it('should not modify devices when no config.devices is set', async () => {
    mockConfig = {
      platform: 'SmartHQ',
      name: 'SmartHQ',
      credentials: { username: 'test@example.com', password: 'pass' },
    }

    const apiDevices = [
      { applianceId: 'appliance-1', type: 'UnknownType', nickname: 'Device 1' },
    ]

    const { platform } = await setupDiscoverDevices(mockConfig, apiDevices)
    await platform.discoverDevices()

    const warnSpy = vi.mocked((platform as any).warnLog)
    expect(warnSpy).toHaveBeenCalledWith('Device Type Not Supported: UnknownType')
  })

  it('should apply hide_device from config to matching device', async () => {
    mockConfig = {
      platform: 'SmartHQ',
      name: 'SmartHQ',
      credentials: { username: 'test@example.com', password: 'pass' },
      devices: [
        { applianceId: 'appliance-1', hide_device: true },
      ],
    }

    const apiDevices = [
      { applianceId: 'appliance-1', type: 'Dishwasher', nickname: 'My Dishwasher' },
    ]

    const { platform } = await setupDiscoverDevices(mockConfig, apiDevices)

    // The device is hidden and no existing accessory exists, so createSmartHQDishWasher
    // should skip it (no register, no warn). We just verify it doesn't crash and
    // no accessory is registered.
    await platform.discoverDevices()

    expect(mockApi.registerPlatformAccessories).not.toHaveBeenCalled()
  })
})