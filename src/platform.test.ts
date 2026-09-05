import type { API, Logging, PlatformConfig } from 'homebridge'

import { Buffer } from 'node:buffer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// Mock the ws module with a bare EventEmitter so tests can play the
// socket lifecycle by hand; the newest instance is recorded for reach
const wsInstances: any[] = []
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeWs extends EventEmitter {
    constructor() {
      super()
      wsInstances.push(this)
    }

    send() {}
    close() {}
  }
  return { default: FakeWs }
})

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

  /**
   * The subscription covers every appliance on the account, so pushes arrive
   * for appliances with no accessory - hidden, an unsupported type, or not set
   * up yet. That is routine, but it was logged at info level with a message
   * naming no appliance and suggesting the plugin be rerun. One owner's log had
   * 89 copies of it in a day (#120).
   */
  it('should not log at info level for a push it has no accessory for', async () => {
    // 'standard' logging: debug lines are suppressed, info lines are not - so
    // anything reaching log.info here is noise a normal user would see.
    // The awaits matter: infoLog and debugLog are both async, so asserting
    // synchronously would pass whatever the code did.
    ;(platform as any).platformLogging = 'standard'
    ;(platform as any).handleErdPush({
      kind: 'publish#erd',
      item: { applianceId: 'UNKNOWN1', erd: '0x3237', value: '01' },
    })
    await new Promise(res => setImmediate(res))

    expect(mockLog.info).not.toHaveBeenCalled()
    // the value is still kept, so an appliance set up later starts from it
    expect(platform.getLiveErd('UNKNOWN1', '0x3237')).toBe('01')
  })

  it('should say which appliance and erd it ignored, at debug level', async () => {
    // debugLog is async, so let it settle before asserting
    ;(platform as any).platformLogging = 'debug'
    ;(platform as any).handleErdPush({
      kind: 'publish#erd',
      item: { applianceId: 'UNKNOWN1', erd: '0x3237', value: '01' },
    })
    await new Promise(res => setImmediate(res))

    // with 'debug' logging the plugin routes its debug lines through log.info,
    // tagged [DEBUG] - the point here is that the message names the appliance
    // and the erd, which the old line did not
    expect(mockLog.info).toHaveBeenCalledWith('[DEBUG]', expect.stringContaining('UNKNOWN1'))
    expect(mockLog.info).toHaveBeenCalledWith('[DEBUG]', expect.stringContaining('0x3237'))
  })

  /**
   * For an appliance the plugin does not support yet, the pushes that arrive
   * while its owner uses it are exactly the data adding support needs - and a
   * line carrying the erd code but not its value meant a second round trip
   * asking for it (#125).
   */
  it('should include the pushed value in the debug line for an appliance it has no accessory for', async () => {
    ;(platform as any).platformLogging = 'debug'
    ;(platform as any).handleErdPush({
      kind: 'publish#erd',
      item: { applianceId: 'UNKNOWN1', erd: '0x3237', value: '01' },
    })
    await new Promise(res => setImmediate(res))

    expect(mockLog.info).toHaveBeenCalledWith('[DEBUG]', expect.stringContaining('0x3237=01'))
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

    const spies = {
      dishwasher: vi.spyOn(platform as any, 'createSmartHQDishWasher').mockResolvedValue(undefined),
      dishDrawer: vi.spyOn(platform as any, 'createSmartHQDishDrawer').mockResolvedValue(undefined),
    }
    await platform.discoverDevices()
    return spies
  }

  // A Fisher & Paykel DishDrawer announces 'FP DishDrawer', which is not in
  // GE's appliance-type enum and is not derivable from anything documented -
  // it came from an owner's log (#120). Pin the exact string: a typo here puts
  // the appliance straight back to unsupported with nothing to show why.
  //
  // It gets its own handler rather than the dishwasher one: it is two
  // independent drawers, its state lives at different ERDs, and its door
  // polarity is inverted relative to the GE handler's.
  it('sets up an FP DishDrawer with the dish drawer handler', async () => {
    const spies = await discoverOne({ applianceId: 'a-1', type: 'FP DishDrawer', nickname: 'Dish Drawer' })

    expect(spies.dishDrawer).toHaveBeenCalledTimes(1)
    expect(spies.dishwasher).not.toHaveBeenCalled()
    expect(mockLog.warn).not.toHaveBeenCalledWith(expect.stringContaining('Not Supported'))
  })

  it('still sets up an ordinary dishwasher with the dishwasher handler', async () => {
    const spies = await discoverOne({ applianceId: 'a-2', type: 'Dishwasher', nickname: 'Dishwasher' })

    expect(spies.dishwasher).toHaveBeenCalledTimes(1)
    expect(spies.dishDrawer).not.toHaveBeenCalled()
  })

  // With the type unknown there is no handler to read anything, so discovery
  // itself fetches every erd the appliance reports and puts them in the debug
  // log - the one paste an owner can give that is enough to add support (#125)
  it('reads every erd of an appliance it does not recognise', async () => {
    await discoverOne({ applianceId: 'a-4', type: 'Bread Maker', nickname: 'Bread Maker', model: 'BM100' })

    const axios = (await import('axios')).default
    expect(vi.mocked(axios.get)).toHaveBeenCalledWith('/appliance/a-4/erd')
  })

  /**
   * The appliance record sometimes arrives without its firmware. Falling back
   * to the plugin's own version made the value shown in Home flip between the
   * two across restarts (#126) - so the last real value is kept instead.
   */
  it('keeps the firmware an appliance last reported when the api omits it', async () => {
    const getAccessToken = await import('./getAccessToken.js')
    vi.mocked(getAccessToken.default).mockResolvedValue({ access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600 } as any)
    vi.mocked(getAccessToken.refreshAccessToken).mockResolvedValue({ access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600 } as any)
    const axios = (await import('axios')).default
    vi.mocked(axios.get).mockImplementation((url: string) => {
      if (url === '/appliance') {
        return Promise.resolve({ data: { userId: 'user-1', items: [{ applianceId: 'a-5', type: 'Dishwasher', nickname: 'Dishwasher' }] } })
      }
      // details without a firmware field this time round
      return Promise.resolve({ data: {} })
    })
    const platform = new SmartHQPlatform(mockLog, config, mockApi)
    ;(platform as any).accessories.push({ UUID: 'other', context: { device: { applianceId: 'a-5', firmware: '2.1.0' } } })
    const dishwasher = vi.spyOn(platform as any, 'createSmartHQDishWasher').mockResolvedValue(undefined)

    await platform.discoverDevices()

    expect(dishwasher).toHaveBeenCalledTimes(1)
    const details = dishwasher.mock.calls[0][2] as any
    expect(details.firmware).toBe('2.1.0')
  })

  it('names the type and model when it does not recognise an appliance', async () => {
    await discoverOne({ applianceId: 'a-3', type: 'Toaster Oven', nickname: 'Toaster', model: 'TO123' })

    // Quoted, and with the model, so one pasted line is enough to add support
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('"Toaster Oven"'))
  })
})

/**
 * ⚠️ The v2 websocket is shared by every v2 appliance, so the platform owns
 * closing it. ge-smarthq reconnects with exponential backoff of its own, so one
 * left open keeps waking up and reconnecting after Homebridge has torn down —
 * exactly the fault the v1 reconnect timer had before it was cleared here.
 */
describe('smartHQPlatform shutdown', () => {
  let platform: SmartHQPlatform

  beforeEach(() => {
    const mockLog = { prefix: 'SmartHQ', info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logging
    const mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn().mockReturnValue('test-uuid') } },
      on: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
    } as unknown as API
    platform = new SmartHQPlatform(mockLog, { platform: 'SmartHQ', name: 'SmartHQ' } as PlatformConfig, mockApi)
  })

  it('closes the shared v2 websocket', () => {
    const disconnect = vi.fn(async () => {})
    ;(platform as any).v2Transport = { disconnect }

    ;(platform as any).shutdown()

    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('does not fall over when no v2 appliance was ever set up', () => {
    // The overwhelming majority of installs, where the transport is never built
    expect(() => (platform as any).shutdown()).not.toThrow()
  })

  it('survives a disconnect that rejects on the way out', async () => {
    ;(platform as any).v2Transport = { disconnect: vi.fn(async () => {
      throw new Error('socket already gone')
    }) }

    expect(() => (platform as any).shutdown()).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('tells each accessory to shut down too', () => {
    const shutdown = vi.fn()
    ;(platform as any).accessories = [{ control: { shutdown } }]

    ;(platform as any).shutdown()

    expect(shutdown).toHaveBeenCalledTimes(1)
  })
})

/**
 * SmartHQ's servers recycle long-held websocket connections about once an
 * hour. That routine drop used to log a warning every time, so a perfectly
 * healthy setup showed a page of "connection lost" warnings a day and read
 * as broken (#117). Only a socket that could not hold - dropped soon after
 * opening - deserves the warning.
 */
describe('websocket drop logging', () => {
  let platform: SmartHQPlatform
  let mockLog: Logging

  beforeEach(async () => {
    vi.useFakeTimers()
    wsInstances.length = 0
    mockLog = {
      prefix: 'SmartHQ',
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logging
    const mockApi = {
      hap: { Service: {}, Characteristic: {}, uuid: { generate: vi.fn().mockReturnValue('test-uuid') } },
      on: vi.fn(),
    } as unknown as API
    platform = new SmartHQPlatform(mockLog, { platform: 'SmartHQ', name: 'SmartHQ', credentials: { username: 'u', password: 'p' } } as PlatformConfig, mockApi)
    const axios = (await import('axios')).default
    vi.mocked(axios.get).mockResolvedValue({ data: { endpoint: 'wss://example.invalid' } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function dropAfter(heldMs: number) {
    await (platform as any).connectWebSocket()
    const socket = wsInstances.at(-1)
    socket.emit('open')
    vi.advanceTimersByTime(heldMs)
    socket.emit('close', 0, Buffer.from('server recycle'))
  }

  it('treats a drop after a long hold as routine - no warning', async () => {
    await dropAfter(60 * 60 * 1000)

    expect(mockLog.warn).not.toHaveBeenCalledWith(expect.stringContaining('Websocket connection lost'))
  })

  it('still warns when the socket could not hold', async () => {
    await dropAfter(5 * 1000)

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Websocket connection lost'))
  })
})
