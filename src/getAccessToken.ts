import axios from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import * as cheerio from 'cheerio'
import pkg from 'lodash'
import { Issuer } from 'openid-client'
import { CookieJar } from 'tough-cookie'

import { LOGIN_URL, OAUTH2_CLIENT_ID, OAUTH2_CLIENT_SECRET, OAUTH2_REDIRECT_URI } from './settings.js'

const { keyBy, mapValues } = pkg

const oidcClient = Issuer.discover('https://accounts.brillion.geappliances.com/').then(
  geData =>
    new geData.Client({
      client_id: OAUTH2_CLIENT_ID,
      client_secret: OAUTH2_CLIENT_SECRET,
      response_types: ['code'],
    }),
)

export async function refreshAccessToken(refresh_token: string) {
  const client = await oidcClient
  return client.grant({ refresh_token, grant_type: 'refresh_token' })
}

export default async function getAccessToken(username: string, password: string) {
  const client = await oidcClient

  const oauthUrl = client.authorizationUrl()

  const jar = new CookieJar()
  const aclient = wrapper(axios.create({ jar }))
  const htmlPageResponse = await aclient.get(oauthUrl)

  const page = cheerio.load(htmlPageResponse.data)
  const carryInputs = mapValues(
    keyBy(page('#frmsignin').serializeArray(), o => o.name),
    t => t.value,
  )

  const body = new URLSearchParams({ ...carryInputs, username, password })

  const res = await aclient({
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'origin': 'https://accounts.brillion.geappliances.com',
    },
    url: 'https://accounts.brillion.geappliances.com/oauth2/g_authenticate',
    data: body,
    maxRedirects: 0,
    validateStatus: () => true,
  })

  // If the initial POST did not return a redirect with the code, the login
  // flow may have hit an intermediate page (MFA enrollment or Terms acceptance).
  // Attempt to handle those pages automatically; fall back to an error with
  // guidance if not possible.
  const tryExtractCodeFromLocation = (location?: string | null) => {
    if (!location) {
      return null
    }
    try {
      return new URL(location).searchParams.get('code')
    } catch (e) {
      // Handle relative URLs
      try {
        const full = new URL(location, LOGIN_URL).toString()
        return new URL(full).searchParams.get('code')
      } catch (e) {
        return null
      }
    }
  }

  let code = tryExtractCodeFromLocation(res.headers.location)
  if (!code) {
    // Try to handle HTML response pages (MFA or Terms)
    const asyncHandleOkResponse = async (respText: string): Promise<string> => {
      // MFA enrollment page
      if (respText.includes('Add Multi-Factor Authentication') || respText.includes('addMfaForm')) {
        try {
          const $ = cheerio.load(respText)
          const mfaForm = $('#addMfaForm')
          if (!mfaForm || mfaForm.length === 0) {
            throw new Error('MFA form not found')
          }

          const formData: Record<string, string> = {}
          mfaForm.find('input').each((i, el) => {
            const name = $(el).attr('name')
            if (!name) {
              return
            }
            formData[name] = $(el).val() as string || ''
          })

          // Try meta tag for CSRF if not present
          if (!formData._csrf) {
            const csrfMeta = $('meta[name="_csrf"]').attr('content')
            if (csrfMeta) {
              formData._csrf = csrfMeta
            }
          }

          const postData = new URLSearchParams(formData)
          const skipResp = await aclient({
            method: 'POST',
            url: new URL('/account/active/redirect', LOGIN_URL).toString(),
            data: postData,
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            maxRedirects: 0,
            validateStatus: () => true,
          })

          const loc = skipResp.headers.location
          const gotCode = tryExtractCodeFromLocation(loc)
          if (gotCode) {
            return gotCode
          }

          // Follow redirect manually if provided
          if (loc) {
            const resolved = new URL(loc, LOGIN_URL).toString()
            const redirectResp = await aclient.get(resolved, { maxRedirects: 0, validateStatus: () => true })
            const finalLoc = redirectResp.headers.location
            const finalCode = tryExtractCodeFromLocation(finalLoc)
            if (finalCode) {
              return finalCode
            }
            if (redirectResp.status === 200) {
              return await asyncHandleOkResponse(await redirectResp.data)
            }
          }

          if (skipResp.status === 200) {
            return await asyncHandleOkResponse(await skipResp.data)
          }
          throw new Error('MFA skip failed')
        } catch (e) {
          throw new Error(`MFA handling failed: ${(e as Error).message}`)
        }
      }

      // Terms acceptance page
      if (respText.includes('Almost Finished') && respText.includes('/oauth2/terms/accept')) {
        try {
          const $ = cheerio.load(respText)
          let termsForm = $('#termsform')
          if (!termsForm || termsForm.length === 0) {
            termsForm = $('form[name=\'termsform\']')
          }
          if (!termsForm || termsForm.length === 0) {
            // Fallback: try to extract required fields with regex
            const formData: Record<string, string> = {}
            const sigMatch = respText.match(/name="signature"\\s+value="([^"]+)"/)
            if (sigMatch) {
              formData.signature = sigMatch[1]
            }
            const lasMatch = respText.match(/name="login_actions_signature"[^>]*value=([^>\\s]+)/)
            if (lasMatch) {
              formData.login_actions_signature = lasMatch[1].replace(/>$/, '')
            }
            const devMatch = respText.match(/name="isDeveloper"\\s+value="([^"]+)"/)
            if (devMatch) {
              formData.isDeveloper = devMatch[1]
            }
            const csrfMatch = respText.match(/name="_csrf"\\s+value="([^"]+)"/)
            if (csrfMatch) {
              formData._csrf = csrfMatch[1]
            }
            formData.developerTerms = 'on'
            formData.connected_terms = 'on'

            const headers: Record<string, string> = {}
            if (formData._csrf) {
              headers['X-CSRF-TOKEN'] = formData._csrf
            }

            const termsResp = await aclient({
              method: 'POST',
              url: new URL('/oauth2/terms/accept', LOGIN_URL).toString(),
              data: new URLSearchParams(formData),
              headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
              maxRedirects: 0,
              validateStatus: () => true,
            })

            const loc = termsResp.headers.location
            const gotCode = tryExtractCodeFromLocation(loc)
            if (gotCode) {
              return gotCode
            }
            if (loc) {
              const resolved = new URL(loc, LOGIN_URL).toString()
              const redirectResp = await aclient.get(resolved, { maxRedirects: 0, validateStatus: () => true })
              const finalCode = tryExtractCodeFromLocation(redirectResp.headers.location)
              if (finalCode) {
                return finalCode
              }
              if (redirectResp.status === 200) {
                return await asyncHandleOkResponse(await redirectResp.data)
              }
            }
            if (termsResp.status === 200) {
              return await asyncHandleOkResponse(await termsResp.data)
            }
            throw new Error('Terms acceptance failed')
          }

          // Collect inputs from the form
          const formData: Record<string, string> = {}
          termsForm.find('input').each((i, el) => {
            const name = $(el).attr('name')
            if (!name) {
              return
            }
            formData[name] = $(el).val() as string || ''
          })
          // Set checkboxes to accepted
          formData.developerTerms = 'on'
          formData.connected_terms = 'on'

          if (!formData._csrf) {
            const csrfMeta = $('meta[name="_csrf"]').attr('content')
            if (csrfMeta) {
              formData._csrf = csrfMeta
            }
          }

          const headers: Record<string, string> = {}
          if (formData._csrf) {
            headers['X-CSRF-TOKEN'] = formData._csrf
          }

          const termsResp = await aclient({
            method: 'POST',
            url: new URL('/oauth2/terms/accept', LOGIN_URL).toString(),
            data: new URLSearchParams(formData),
            headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
            maxRedirects: 0,
            validateStatus: () => true,
          })

          const loc = termsResp.headers.location
          const gotCode = tryExtractCodeFromLocation(loc)
          if (gotCode) {
            return gotCode
          }
          if (loc) {
            const resolved = new URL(loc, LOGIN_URL).toString()
            const redirectResp = await aclient.get(resolved, { maxRedirects: 0, validateStatus: () => true })
            const finalCode = tryExtractCodeFromLocation(redirectResp.headers.location)
            if (finalCode) {
              return finalCode
            }
            if (redirectResp.status === 200) {
              return await asyncHandleOkResponse(await redirectResp.data)
            }
          }
          if (termsResp.status === 200) {
            return await asyncHandleOkResponse(await termsResp.data)
          }
          throw new Error('Terms acceptance failed')
        } catch (e) {
          throw new Error(`Terms handling failed: ${(e as Error).message}`)
        }
      }

      throw new Error('Authentication failed: No authorization code received and no known intermediate page detected')
    }

    // If we have HTML in the response, try to handle it
    if (res.data && typeof res.data === 'string') {
      code = await asyncHandleOkResponse(res.data)
    }
  }

  if (!code) {
    throw new Error('Authentication failed: No authorization code received')
  }

  return client.grant({ grant_type: 'authorization_code', code, redirect_uri: OAUTH2_REDIRECT_URI })
}
