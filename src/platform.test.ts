import type { API, Logging, PlatformConfig } from 'homebridge'

import { describe, expect, it, vi, beforeEach } from 'vitest'

import { SmartHQPlatform } from './platform.js'

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

    const axios = (await import('axios')).default
    const mockGet = vi.mocked(axios.get)
    mockGet.mockImplementation((url: string) => {
      if (url === '/appliance') {
        return Promise.resolve({ data: { userId: 'user-1', items: apiDevices } })
      }
      // Mock the per-device detail + feature endpoints so the discovery
      // loop proceeds past Promise.all and actually exercises the
      // hide_device path. Without this, the loop crashed before the
      // hide_device check and the test passed for the wrong reason.
      if (url.startsWith('/appliance/appliance-1')) {
        return Promise.resolve({ data: {} })
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })

    const platform = new SmartHQPlatform(mockLog, mockConfig, mockApi)

    await platform.discoverDevices()

    expect(mockApi.registerPlatformAccessories).not.toHaveBeenCalled()
  })
})
