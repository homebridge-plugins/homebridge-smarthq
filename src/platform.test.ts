import type { API, Logging, PlatformConfig } from 'homebridge'

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('smartHQPlatform Authentication Error Handling', () => {
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
      expect.stringContaining('discoverDevices, Failed to get Access Token, Error Message: Invalid URL'),
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
      expect.stringContaining('Username or password is undefined'),
    )
  })
})

describe('smartHQPlatform Per-Device Config Merge', () => {
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

describe('smartHQPlatform live ERD cache', () => {
  let platform: SmartHQPlatform
  let mockApi: API
  let mockLog: Logging
  let mockConfig: PlatformConfig

  beforeEach(() => {
    mockLog = { prefix: 'SmartHQ', info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logging
    mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn().mockReturnValue('test-uuid') } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
    } as unknown as API
    mockConfig = {
      platform: 'SmartHQ',
      name: 'SmartHQ',
      credentials: { username: 'test@example.com', password: 'testpassword' },
    }
    platform = new SmartHQPlatform(mockLog, mockConfig, mockApi)
    vi.clearAllMocks()
  })

  it('should have nothing live until the appliance pushes something', () => {
    expect(platform.getLiveErd('APPLIANCE1', '0x1160')).toBeUndefined()
  })

  it('should return a value the appliance pushed', () => {
    ;(platform as any).setLiveErd('APPLIANCE1', '0x1160', '00D3')

    expect(platform.getLiveErd('APPLIANCE1', '0x1160')).toBe('00D3')
  })

  it('should match the pushed code whatever case each side uses', () => {
    // the websocket sends 0x116D, settings.ts spells it 0x116d
    ;(platform as any).setLiveErd('APPLIANCE1', '0x116D', '003A')

    expect(platform.getLiveErd('APPLIANCE1', '0x116d')).toBe('003A')
    expect(platform.getLiveErd('APPLIANCE1', '0x116D')).toBe('003A')
  })

  it('should keep appliances separate', () => {
    ;(platform as any).setLiveErd('APPLIANCE1', '0x1160', '00D3')

    expect(platform.getLiveErd('APPLIANCE2', '0x1160')).toBeUndefined()
  })

  it('should replace an older value with a newer push', () => {
    ;(platform as any).setLiveErd('APPLIANCE1', '0x1160', '00D3')
    ;(platform as any).setLiveErd('APPLIANCE1', '0x1160', '00D4')

    expect(platform.getLiveErd('APPLIANCE1', '0x1160')).toBe('00D4')
  })

  it('should forget everything when the websocket drops, rather than serve stale values', () => {
    ;(platform as any).setLiveErd('APPLIANCE1', '0x1160', '00D3')
    ;(platform as any).clearLiveErds()

    expect(platform.getLiveErd('APPLIANCE1', '0x1160')).toBeUndefined()
  })
})

describe('smartHQPlatform appliance type dispatch', () => {
  let mockApi: API
  let mockLog: Logging

  const config = {
    platform: 'SmartHQ',
    name: 'SmartHQ',
    credentials: { username: 'test@example.com', password: 'pass' },
  } as unknown as PlatformConfig

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
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn().mockReturnValue('test-uuid') } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
    } as unknown as API
  })

  const discoverOne = async (device: Record<string, unknown>) => {
    // Without a token set, discoverDevices bails at startRefreshTokenLogic long
    // before the type switch - which would make every assertion below pass or
    // fail for reasons that have nothing to do with the dispatch. No
    // refresh_token, so the refresh path is skipped too.
    const getAccessToken = await import('./getAccessToken.js')

    vi.mocked(getAccessToken.default).mockResolvedValue({ access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600 } as any)
    vi.mocked(getAccessToken.refreshAccessToken).mockResolvedValue({ access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600 } as any)

    const axios = (await import('axios')).default
    vi.mocked(axios.get).mockImplementation((url: string) => {
      if (url === '/appliance') {
        return Promise.resolve({ data: { userId: 'user-1', items: [device] } })
      }
      if (url.startsWith('/appliance/')) {
        return Promise.resolve({ data: {} })
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })
    const platform = new SmartHQPlatform(mockLog, config, mockApi)

    const spy = vi.spyOn(platform as any, 'createSmartHQDishWasher').mockResolvedValue(undefined)
    await platform.discoverDevices()
    return spy
  }

  // A Fisher & Paykel DishDrawer announces 'FP DishDrawer', which is not in
  // GE's appliance-type enum and is not derivable from anything documented -
  // it came from an owner's log (#120). Pin the exact string: a typo here puts
  // the appliance straight back to unsupported with nothing to show why.
  it('sets up an FP DishDrawer with the dishwasher handler', async () => {
    const spy = await discoverOne({ applianceId: 'a-1', type: 'FP DishDrawer', nickname: 'Dish Drawer' })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(mockLog.warn).not.toHaveBeenCalledWith(expect.stringContaining('Not Supported'))
  })

  it('still sets up an ordinary dishwasher', async () => {
    const spy = await discoverOne({ applianceId: 'a-2', type: 'Dishwasher', nickname: 'Dishwasher' })

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('names the type and model when it does not recognise an appliance', async () => {
    await discoverOne({ applianceId: 'a-3', type: 'Toaster Oven', nickname: 'Toaster', model: 'TO123' })

    // Quoted, and with the model, so one pasted line is enough to add support
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('"Toaster Oven"'))
  })
})
