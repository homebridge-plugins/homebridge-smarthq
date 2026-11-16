import { beforeEach, describe, expect, it, vi } from 'vitest'

const { grant, requests, routes } = vi.hoisted(() => ({
  grant: vi.fn(async (params: Record<string, string>) => ({ access_token: 'token', ...params })),
  requests: [] as { method: string, path: string, data: URLSearchParams | undefined }[],
  routes: new Map<string, (data: URLSearchParams | undefined) => { status: number, headers?: Record<string, string>, data?: string }>(),
}))

vi.mock('openid-client', () => ({
  custom: {
    setHttpOptionsDefaults: vi.fn(),
  },
  Issuer: {
    discover: vi.fn(async () => ({
      Client: class {
        authorizationUrl() {
          return 'https://accounts.brillion.geappliances.com/oauth2/auth'
        }

        grant = grant
      },
    })),
  },
}))

vi.mock('axios-cookiejar-support', () => ({
  wrapper: (client: unknown) => client,
}))

vi.mock('axios', () => {
  const handle = async (method: string, url: string, data?: URLSearchParams) => {
    const { pathname, search } = new URL(url)
    const path = pathname + search
    requests.push({ method, path, data })
    const route = routes.get(`${method} ${path}`)
    if (!route) {
      throw new Error(`unexpected request ${method} ${path}`)
    }
    return {
      headers: {},
      ...route(data),
    }
  }
  const client = Object.assign(
    async (config: { method: string, url: string, data?: URLSearchParams }) => handle(config.method, config.url, config.data),
    {
      get: async (url: string) => handle('GET', url),
    },
  )
  return {
    default: {
      create: () => client,
    },
  }
})

// Trimmed copies of the pages accounts.brillion.geappliances.com served in
// November 2026, with tokens and signatures removed
const csrf = '<input type="hidden" name="_csrf" value="csrf-token"/>'
const logoutForm = `<form id="frmlogout" name="frmlogout" method="post"><input type="hidden" name="signature" value="sig"/>${csrf}</form>`
const optionsPage = `<html><head><title>Verify It&#39;s You - Web</title></head><body>
<form id="verifyOptionForm" name="verifyOptionForm" accept-charset="utf-8" method="post">
<input type="hidden" name="mfaType" id="mfaType" value=""/>
<p>Select from the following options:</p>
<button type="button" id="email_btn" name="email_btn" value="email" onclick="javascript:verify_email_btn_onclick()">EMAIL</button>
${csrf}</form>${logoutForm}</body></html>`
const sendPage = `<html><head><title>Verify Send TOTP - Web</title></head><body>
<form id="verifyTotp" name="verifyTotp" accept-charset="utf-8" method="POST">
<input type="hidden" id="mfaType" name="mfaType" value="email"/>
<p>Click the button below to receive a code via email.</p>
<button type="button" onclick="javascript:sendTotp()">SEND EMAIL</button>
${csrf}</form>${logoutForm}</body></html>`
const entryPage = `<html><head><title>Verify Login TOTP - Web</title></head><body>
<p>We have sent a code to your email address. Enter the code to verify your identity.</p>
<form id="verifyTotp" name="verifyTotp" accept-charset="utf-8" method="POST">
<input type="hidden" id="mfaType" name="mfaType" value="email"/>
<input type="text" id="totpCode" name="totpCode" value="" minlength="6" maxlength="6" inputmode="numeric"/>
<button type="button" onclick="javascript:verifyCode()">VERIFY</button>
${csrf}</form>
<form id="frmresend" name="frmresend" method="post"><input type="hidden" name="mfaType" value="email"/><input type="hidden" name="resendFlag" value="true"/>${csrf}</form>
${logoutForm}</body></html>`

const html = (data: string) => () => ({ status: 200, data })

function routeEmail2faAccount(validCode: string) {
  routes.clear()
  routes.set('GET /oauth2/auth', html('<form id="frmsignin"><input name="state" value="s"/></form>'))
  routes.set('POST /oauth2/g_authenticate', () => ({
    status: 302,
    headers: { location: '/account/active/security/verify/options' },
  }))
  routes.set('GET /account/active/security/verify/options', html(optionsPage))
  routes.set('POST /account/active/security/verify/sendtotp', html(sendPage))
  routes.set('POST /account/active/security/verify/sendtotp/process?emailType=MFA_VERIFICATION', html(entryPage))
  routes.set('POST /account/active/security/send/email?emailType=MFA_VERIFICATION', html(entryPage))
  routes.set('POST /account/active/security/verify/totpcode/process', data => data?.get('totpCode') === validCode
    ? {
        status: 302,
        headers: { location: 'brillion.app://oauth/redirect?code=auth-code&expires_in=600' },
      }
    : { status: 200, data: entryPage })
}

const posted = (path: string) => requests.filter(r => r.method === 'POST' && r.path === path)

describe('getAccessToken with SmartHQ email 2FA', () => {
  beforeEach(() => {
    requests.length = 0
    grant.mockClear()
    routeEmail2faAccount('123456')
  })

  it('emails a code and asks for it when no code is configured', async () => {
    const { default: getAccessToken } = await import('./getAccessToken.js')

    await expect(getAccessToken('user@example.com', 'pw')).rejects.toThrow('a verification code has been emailed to you')

    const [choice] = posted('/account/active/security/verify/sendtotp')
    expect(choice.data?.get('mfaType')).toBe('email')
    expect(choice.data?.get('_csrf')).toBe('csrf-token')
    expect(posted('/account/active/security/verify/sendtotp/process?emailType=MFA_VERIFICATION')).toHaveLength(1)
    expect(posted('/account/active/security/verify/totpcode/process')).toHaveLength(0)
  })

  it('logs in with a configured code without emailing another one', async () => {
    const { default: getAccessToken } = await import('./getAccessToken.js')

    await getAccessToken('user@example.com', 'pw', undefined, ' 123456 ')

    expect(posted('/account/active/security/verify/totpcode/process')[0].data?.get('totpCode')).toBe('123456')
    expect(posted('/account/active/security/verify/sendtotp/process?emailType=MFA_VERIFICATION')).toHaveLength(0)
    expect(grant).toHaveBeenCalledWith(expect.objectContaining({ grant_type: 'authorization_code', code: 'auth-code' }))
  })

  it('emails a fresh code when the configured one is rejected', async () => {
    const { default: getAccessToken } = await import('./getAccessToken.js')

    await expect(getAccessToken('user@example.com', 'pw', undefined, '000000')).rejects.toThrow('A new code has been emailed to you')

    expect(posted('/account/active/security/verify/totpcode/process')).toHaveLength(1)
    expect(posted('/account/active/security/send/email?emailType=MFA_VERIFICATION')[0].data?.get('resendFlag')).toBe('true')
    expect(grant).not.toHaveBeenCalled()
  })

  it('reports a method choice without email', async () => {
    routes.set('GET /account/active/security/verify/options', html(optionsPage.replace(/<button[^>]*email_btn[^>]*>EMAIL<\/button>/, '')))
    const { default: getAccessToken } = await import('./getAccessToken.js')

    await expect(getAccessToken('user@example.com', 'pw', undefined, '123456')).rejects.toThrow('email is not offered')
  })
})
