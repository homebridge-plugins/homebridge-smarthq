import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SmartHQV2 } from './smarthqV2.js'

/**
 * The v2 transport borrows the plugin's token rather than logging in again, and
 * the library must never be allowed to run its own OAuth with the placeholder
 * credentials it is constructed with.
 *
 * Seeding an expiry is not enough on its own: `attemptReconnect()` refreshes on
 * every websocket reconnect regardless of expiry, and the 401 handlers refresh
 * before retrying. Shipping without covering those turned one websocket drop
 * into a sustained run of 401s against GE's auth endpoint, so this pins the
 * replacement in place.
 */
describe('borrowing the plugin token for v2', () => {
  let platform: any
  let token: any

  beforeEach(() => {
    token = { access_token: 'first-token', refresh_token: 'refresh-1' }
    platform = {
      currentTokenSet: () => token,
      debugLog: vi.fn(async () => {}),
    }
  })

  /** Reach the client the transport lazily builds, without connecting. */
  const clientOf = async (v2: SmartHQV2) => {
    await (v2 as any).getClient()
    return (v2 as any).client
  }

  it('replaces the library refresh so no OAuth call can happen', async () => {
    const v2 = new SmartHQV2(platform)
    const client = await clientOf(v2)

    // If the library's own implementation were still in place this would try to
    // reach the token endpoint; the replacement resolves locally instead.
    await expect(client.refreshAccessToken()).resolves.toMatchObject({
      access_token: 'first-token',
    })
  })

  it('serves a genuinely new token when the plugin has refreshed', async () => {
    const v2 = new SmartHQV2(platform)
    const client = await clientOf(v2)

    await client.refreshAccessToken()
    token = { access_token: 'second-token', refresh_token: 'refresh-2' }

    await expect(client.refreshAccessToken()).resolves.toMatchObject({
      access_token: 'second-token',
    })
  })

  /**
   * Most refreshes are routine websocket reconnects that need no new token at
   * all. An earlier version threw here to stop runaway retries, which turned
   * every reconnect into a permanent failure and left the socket down with the
   * accessory frozen. Repeating the current token is always safe, because the
   * replacement makes no network call — the runaway case is bounded in the
   * library instead, where a 401 is retried exactly once.
   */
  it('keeps serving the same token across repeated reconnects', async () => {
    const v2 = new SmartHQV2(platform)
    const client = await clientOf(v2)

    for (let i = 0; i < 5; i++) {
      await expect(client.refreshAccessToken()).resolves.toMatchObject({
        access_token: 'first-token',
      })
    }
  })

  it('refuses to run at all with no token to borrow', async () => {
    const v2 = new SmartHQV2({ ...platform, currentTokenSet: () => undefined })
    await expect((v2 as any).getClient()).rejects.toThrow(/no smarthq access token/i)
  })

  /**
   * ge-smarthq is imported lazily so that a missing or unimportable library
   * costs one appliance rather than the whole platform — a static import made
   * Homebridge report ERROR LOADING PLUGIN and take every device down with it.
   * The message has to say so, because it is what an owner sees in the log.
   */
  it('reports a library that will not load as one appliance lost, not the platform', async () => {
    const v2 = new SmartHQV2(platform)
    vi.spyOn(v2 as any, 'loadClientClass').mockRejectedValue(
      new Error('the ge-smarthq library could not be loaded (Cannot find package), '
        + 'so appliances that need the v2 API are unavailable; every other appliance is unaffected'),
    )
    await expect((v2 as any).getClient()).rejects.toThrow(/every other appliance is unaffected/)
  })
})
