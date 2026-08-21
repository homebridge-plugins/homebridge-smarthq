import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { decodeErdString, deviceBase, isTransientNetworkError } from './device.js'

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}))

/**
 * #119: an Opal owner reported `readErd 0x9106 error: connect ETIMEDOUT ...`
 * and reasonably read it as the ice maker or that ERD being broken. It was
 * neither - the request never reached the API, and the same ERD read fine
 * moments later. The plugin gave up after one attempt and warned as though
 * something was wrong.
 */

const mockedGet = vi.mocked(axios.get)

/**
 * The shape a happy-eyeballs connect failure actually arrives in: an
 * AggregateError whose own `code` is undefined, carrying one child per address
 * tried. This is the exact case a naive `error.code` check misses.
 */
function aggregateConnectError() {
  const error: any = new Error('connect ETIMEDOUT 18.160.172.88:443')
  error.errors = [
    Object.assign(new Error('connect ETIMEDOUT 18.160.172.88:443'), { code: 'ETIMEDOUT' }),
    Object.assign(new Error('connect ENETUNREACH 2600:9000::1:443'), { code: 'ENETUNREACH' }),
  ]
  return error
}

function makeDevice() {
  const device = Object.create(deviceBase.prototype)
  device.unsupportedErds = new Set<string>()
  device.optionalErds = new Set<string>()
  device.platform = { getLiveErd: () => undefined }
  device.getApplianceId = () => 'appliance-1'
  device.debugLog = vi.fn(async () => {})
  device.warnLog = vi.fn(async () => {})
  return device
}

describe('isTransientNetworkError', () => {
  it('recognises a bare connection error code', () => {
    expect(isTransientNetworkError({ code: 'ETIMEDOUT' })).toBe(true)
    expect(isTransientNetworkError({ code: 'EAI_AGAIN' })).toBe(true)
  })

  it('recognises the aggregate error node raises when every address fails', () => {
    expect(isTransientNetworkError(aggregateConnectError())).toBe(true)
  })

  it('does not treat an answered request as a connection problem', () => {
    // The API replied - a 400 for an unsupported ERD must not be retried
    expect(isTransientNetworkError({ response: { status: 400 }, code: 'ETIMEDOUT' })).toBe(false)
    expect(isTransientNetworkError({ response: { status: 500 } })).toBe(false)
  })

  it('ignores errors that are not connection failures', () => {
    expect(isTransientNetworkError({ code: 'ERR_BAD_OPTION' })).toBe(false)
    expect(isTransientNetworkError(new Error('nope'))).toBe(false)
    expect(isTransientNetworkError(undefined)).toBe(false)
  })
})

describe('readErd transient network handling', () => {
  beforeEach(() => {
    mockedGet.mockReset()
  })

  it('retries a connection failure and returns the value once it succeeds', async () => {
    const device = makeDevice()
    mockedGet
      .mockRejectedValueOnce(aggregateConnectError())
      .mockResolvedValueOnce({ data: { value: '01' } } as any)

    await expect(device.readErd('0x9106')).resolves.toBe('01')
    expect(mockedGet).toHaveBeenCalledTimes(2)
    // The blip is recorded, but not as a fault
    expect(device.warnLog).not.toHaveBeenCalled()
  })

  it('warns only after every attempt has failed', async () => {
    const device = makeDevice()
    mockedGet.mockRejectedValue(aggregateConnectError())

    await expect(device.readErd('0x9106')).resolves.toBeUndefined()
    expect(mockedGet).toHaveBeenCalledTimes(3)
    expect(device.warnLog).toHaveBeenCalledTimes(1)
    expect(vi.mocked(device.warnLog).mock.calls[0][0]).toContain('after 3 attempts')
  })

  it('does not retry an unsupported ERD, which the api has actually answered', async () => {
    const device = makeDevice()
    mockedGet.mockRejectedValue({ response: { status: 400 } })

    await expect(device.readErd('0x9106')).resolves.toBeUndefined()
    expect(mockedGet).toHaveBeenCalledTimes(1)
    expect(device.unsupportedErds.has('0x9106')).toBe(true)
  })
})

/**
 * Reported by email: a Fisher & Paykel washer showed "Unknown" as its serial
 * number in the Home app. The SmartHQ cloud sends that literal string rather
 * than omitting the field, so there was nothing to notice - the plugin
 * dutifully published it.
 */
describe('decodeErdString', () => {
  it('decodes a hex-encoded serial number', () => {
    // "MZ123456"
    expect(decodeErdString('4d5a313233343536')).toBe('MZ123456')
  })

  it('drops the null padding an ERD pads a serial with', () => {
    expect(decodeErdString('4d5a3132333435360000000000')).toBe('MZ123456')
  })

  it('handles an 0x prefix and upper case', () => {
    expect(decodeErdString('0x4D5A313233343536')).toBe('MZ123456')
  })

  it('gives nothing back for padding alone, an empty value or no value', () => {
    expect(decodeErdString('00000000')).toBe('')
    expect(decodeErdString('')).toBe('')
    expect(decodeErdString('   ')).toBe('')
    expect(decodeErdString(undefined)).toBe('')
  })

  it('passes through a value the appliance already sent as text', () => {
    // Odd length and non-hex characters, so it cannot be a hex payload
    expect(decodeErdString('MZ-123456')).toBe('MZ-123456')
  })
})

describe('resolveSerialNumber', () => {
  function makeAccessoryDevice(deviceContext: Record<string, unknown>) {
    const device = makeDevice()
    device.accessory = { context: { device: deviceContext } }
    device.readErd = vi.fn(async () => undefined)
    return device
  }

  it('prefers the serial the user typed in over everything else', async () => {
    const device = makeAccessoryDevice({ serialNumber: '  MZ999999  ', serial: 'CLOUD1' })

    await expect(device.resolveSerialNumber()).resolves.toBe('MZ999999')
    expect(device.readErd).not.toHaveBeenCalled()
  })

  it('uses the cloud serial when there is a real one', async () => {
    const device = makeAccessoryDevice({ serial: 'CLOUD1' })

    await expect(device.resolveSerialNumber()).resolves.toBe('CLOUD1')
    expect(device.readErd).not.toHaveBeenCalled()
  })

  it('asks the appliance when the cloud says Unknown', async () => {
    const device = makeAccessoryDevice({ serial: 'Unknown' })
    device.readErd = vi.fn(async () => '4d5a313233343536')

    await expect(device.resolveSerialNumber()).resolves.toBe('MZ123456')
    expect(device.readErd).toHaveBeenCalledWith('0x0002')
  })

  it('asks the appliance when the cloud sent no serial at all', async () => {
    const device = makeAccessoryDevice({})
    device.readErd = vi.fn(async () => '4d5a313233343536')

    await expect(device.resolveSerialNumber()).resolves.toBe('MZ123456')
  })

  it('leaves the panel reading Unknown when nothing knows the serial', async () => {
    // Rather than going blank, which would look like a new fault
    const device = makeAccessoryDevice({ serial: 'Unknown' })

    await expect(device.resolveSerialNumber()).resolves.toBe('Unknown')
  })
})
