import axios from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import * as cheerio from 'cheerio'
import pkg from 'lodash'
import { custom, Issuer } from 'openid-client'
import { CookieJar } from 'tough-cookie'

import { LOGIN_URL, OAUTH2_CLIENT_ID, OAUTH2_CLIENT_SECRET, OAUTH2_REDIRECT_URI } from './settings.js'

const { keyBy, mapValues } = pkg

// The openid-client default timeout of 3500ms is too tight for slower networks
// and DNS setups, causing 'outgoing request timed out after 3500ms' login
// failures (#7, #73)
custom.setHttpOptionsDefaults({ timeout: 15000 })

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

export default async function getAccessToken(username: string, password: string, region?: string, mfaCode?: string) {
  const client = await oidcClient

  // Guards the 2FA challenge handler below: a code is submitted at most once
  // per login attempt, so a wrong/expired code cannot loop forever
  let mfaAttempted = false

  const oauthUrl = client.authorizationUrl()

  const jar = new CookieJar()
  const aclient = wrapper(axios.create({ jar }))

  // The accounts site guesses the account region from the request origin,
  // which mismatches when for example a US user routes DNS through Europe.
  // Visiting the site with an explicit region first stores the choice in a
  // cookie which the login flow then honours (#30)
  if (region) {
    await aclient.get(new URL(`/?region=${region}`, LOGIN_URL).toString()).catch(() => {})
  }

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

  const followRedirectsForCode = async (initialLocation: string, maxHops = 10) => {
    let location: string | undefined | null = initialLocation

    for (let hop = 0; hop < maxHops && location; hop++) {
      const codeFromLocation = tryExtractCodeFromLocation(location)
      if (codeFromLocation) {
        return { code: codeFromLocation, response: null }
      }

      const resolved = new URL(location, LOGIN_URL).toString()
      const redirectResponse = await aclient.get(resolved, {
        maxRedirects: 0,
        validateStatus: () => true,
      })

      location = redirectResponse.headers.location
      if (!location) {
        return { code: null, response: redirectResponse }
      }
    }

    return { code: null, response: null }
  }

  let code = tryExtractCodeFromLocation(res.headers.location)
  let finalAuthResponse = res

  if (!code && res.headers.location) {
    const redirectResult = await followRedirectsForCode(res.headers.location)
    code = redirectResult.code

    if (redirectResult.response) {
      finalAuthResponse = redirectResult.response
    }
  }

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

      // 2FA verification challenge page — the account already has multi-factor
      // authentication turned on (distinct from the enrollment page above,
      // which offers to add it). This page has never been captured from a real
      // account, so it is detected generically: a page that talks about a
      // verification code, containing a form whose visible input looks like a
      // code field. Debug details are included in the errors so a failed guess
      // is reportable.
      if (/verification code|security code|multi-?factor|two-?factor|one-?time (?:pass)?code|enter (?:the |your )?code/i.test(respText)) {
        const $ = cheerio.load(respText)
        let challengeFormEl: any = null
        let codeInputName: string | undefined

        $('form').each((_, formEl) => {
          if (challengeFormEl) {
            return
          }
          $(formEl).find('input').each((__, inputEl) => {
            if (codeInputName) {
              return
            }
            const input = $(inputEl)
            const type = (input.attr('type') ?? 'text').toLowerCase()
            if (['hidden', 'submit', 'checkbox', 'password', 'email'].includes(type)) {
              return
            }
            const nameAndId = `${input.attr('name') ?? ''} ${input.attr('id') ?? ''}`
            if (/code|otp|pin|mfa|token/i.test(nameAndId)) {
              challengeFormEl = formEl
              codeInputName = input.attr('name')
            }
          })
        })

        if (challengeFormEl && codeInputName) {
          if (mfaAttempted) {
            throw new Error('2FA verification failed: the code was not accepted (wrong or expired). Restart Homebridge to trigger a fresh code, update the "2FA Verification Code" setting with the new code, then restart once more.')
          }
          if (!mfaCode) {
            throw new Error('Your SmartHQ account has two-factor authentication (2FA) turned on. Check your email or phone for a verification code, paste it into the plugin\'s "2FA Verification Code" setting, then restart Homebridge. After one successful login the plugin saves a token and will not ask again. Alternatively, turn off 2FA on your SmartHQ account.')
          }
          mfaAttempted = true

          const challengeForm = $(challengeFormEl)
          const formData: Record<string, string> = {}
          challengeForm.find('input').each((i, el) => {
            const name = $(el).attr('name')
            if (!name) {
              return
            }
            formData[name] = $(el).val() as string || ''
          })
          formData[codeInputName] = mfaCode
          if (!formData._csrf) {
            const csrfMeta = $('meta[name="_csrf"]').attr('content')
            if (csrfMeta) {
              formData._csrf = csrfMeta
            }
          }

          const submitUrl = new URL(challengeForm.attr('action') || '/oauth2/g_authenticate', LOGIN_URL).toString()
          const mfaResp = await aclient({
            method: 'POST',
            url: submitUrl,
            data: new URLSearchParams(formData),
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            maxRedirects: 0,
            validateStatus: () => true,
          })

          const loc = mfaResp.headers.location
          const gotCode = tryExtractCodeFromLocation(loc)
          if (gotCode) {
            return gotCode
          }
          if (loc) {
            const redirectResult = await followRedirectsForCode(loc)
            if (redirectResult.code) {
              return redirectResult.code
            }
            if (redirectResult.response?.status === 200 && typeof redirectResult.response.data === 'string') {
              // A successful code entry may still land on another interstitial
              // (for example Terms); the mfaAttempted guard stops a loop if it
              // is the challenge page again
              return await asyncHandleOkResponse(redirectResult.response.data)
            }
          }
          if (mfaResp.status === 200 && typeof mfaResp.data === 'string') {
            return await asyncHandleOkResponse(mfaResp.data)
          }
          throw new Error('2FA verification failed: the code was not accepted (wrong or expired). Restart Homebridge to trigger a fresh code, update the "2FA Verification Code" setting with the new code, then restart once more.')
        }
      }

      // Include what the page looked like so unknown interstitials can be
      // reported and added to the handlers above
      const $unknown = cheerio.load(respText)
      const pageTitle = $unknown('title').text().trim()
      const pageForms = $unknown('form').map((i, el) => $unknown(el).attr('id') || $unknown(el).attr('name') || $unknown(el).attr('action') || 'unnamed').get().join(', ')
      const pageDetails = [pageTitle ? `page title: "${pageTitle}"` : '', pageForms ? `forms: ${pageForms}` : ''].filter(Boolean).join('; ')
      throw new Error(`Authentication failed: No authorization code received and no known intermediate page detected${pageDetails ? ` (${pageDetails})` : ''}`)
    }

    // If we have HTML in the response, try to handle it
    if (finalAuthResponse.data && typeof finalAuthResponse.data === 'string') {
      code = await asyncHandleOkResponse(finalAuthResponse.data)
    }
  }

  if (!code) {
    throw new Error('Authentication failed: No authorization code received')
  }

  return client.grant({ grant_type: 'authorization_code', code, redirect_uri: OAUTH2_REDIRECT_URI })
}
