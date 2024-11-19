import axios from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import * as cheerio from 'cheerio'
import pkg from 'lodash'
import { clientCredentialsGrant, Configuration, discovery } from 'openid-client' // Import discovery and Configuration
import { CookieJar } from 'tough-cookie'

import { LOGIN_URL, OAUTH2_CLIENT_ID, OAUTH2_CLIENT_SECRET, OAUTH2_REDIRECT_URI } from './settings.js'

const { keyBy, mapValues } = pkg

const oidcClient = discovery(new URL(LOGIN_URL), OAUTH2_CLIENT_ID, {
  client_secret: OAUTH2_CLIENT_SECRET,
  token_endpoint_auth_method: 'client_secret_post', // Added for openid-client 6.1.7
}).then(config => new Configuration(config.serverMetadata(), OAUTH2_CLIENT_ID, { client_secret: OAUTH2_CLIENT_SECRET }))

export async function refreshAccessToken(refresh_token: string) {
  const client = await oidcClient
  return client.refresh(refresh_token) // Updated method for openid-client 6.1.7
}

export default async function getAccessToken(username: string, password: string) {
  const client = await oidcClient

  const oauthUrl = client.clientCredentialsGrant({
    redirect_uri: OAUTH2_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid',
  })

  const jar = new CookieJar()
  const aclient = wrapper(axios.create({ jar }))
  const htmlPageResponse = await aclient.get(oauthUrl.toString())

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
  const params = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: OAUTH2_REDIRECT_URI,
  }
  return client.authorizationCallback(OAUTH2_REDIRECT_URI, params) // Updated method for openid-client 6.1.7
}
