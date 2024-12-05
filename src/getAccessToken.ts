import axios from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import * as cheerio from 'cheerio'
import pkg from 'lodash'
import { Issuer } from 'openid-client'
import { CookieJar } from 'tough-cookie'

import { LOGIN_URL, OAUTH2_CLIENT_ID, OAUTH2_CLIENT_SECRET, OAUTH2_REDIRECT_URI } from './settings.js'

const { keyBy, mapValues } = pkg

const oidcClient = Issuer.discover(LOGIN_URL).then(
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

  const code = new URL(res.headers.location).searchParams.get('code')
  return client.grant({ grant_type: 'authorization_code', code, redirect_uri: OAUTH2_REDIRECT_URI })
}
