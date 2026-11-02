/** Versions server exchanges identities without accepting client-selected accounts or exposing service secrets. */
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { createCompanyLoginServer } from '../scripts/company-login-server.ts'

const send = globalThis.fetch
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function endpoint() {
  const server = createCompanyLoginServer({ iamOrigin: 'http://iam-stg.haiercash.work',
    clientSecret: 'fixture-application-secret', authSecret: 'fixture-gateway-secret' })
  onTestFinished(() => new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error) reject(error); else resolve() })
    server.closeAllConnections()
  }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture listener')
  return `http://127.0.0.1:${String(address.port)}/company-login/exchange`
}

const callback = { code: 'fixture-code', redirectUri: 'http://127.0.0.1:18743/oauth/callback' }

it('obtains the personal key from server-verified email without returning application secrets or IAM tokens', async () => {
  const upstream = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: 'private-iam-token' }))
    .mockResolvedValueOnce(Response.json({ ret: 0, email: 'employee@example.test', sub: '18000001', name: '张宁',
      orgName: 'AI工程', orgPathName: '/示例公司/金融科技中心/架构平台/', telephone: 'private-phone', card: 'private-card' }))
    .mockResolvedValueOnce(Response.json({ success: true, status: { code: 20000 }, msg: null, extraInfo: {},
      data: { username: 'lingxi-office_employee', apiKey: 'personal-key', newlyCreated: false, authorizedModels: ['fixture-model'] } }))
  vi.stubGlobal('fetch', upstream)
  const response = await send(await endpoint(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(callback) })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({ apiKey: 'personal-key', account: 'employee', email: 'employee@example.test',
    name: '张宁', orgName: 'AI工程', orgPathName: '/示例公司/金融科技中心/架构平台/' })
  const tokenBody = upstream.mock.calls[0]?.[1]?.body
  expect(upstream.mock.calls[0]?.[0]).toEqual(new URL('http://iam-stg.haiercash.work/sso/oauth2/token'))
  expect(upstream.mock.calls[1]?.[0]).toEqual(new URL('http://iam-stg.haiercash.work/sso/oauth2/userInfo'))
  expect(tokenBody).toBeInstanceOf(URLSearchParams)
  expect((tokenBody as URLSearchParams).get('client_secret')).toBe('fixture-application-secret')
  const keyBody = upstream.mock.calls[2]?.[1]?.body
  if (typeof keyBody !== 'string') throw new Error('Expected a JSON string for the personal-key request body')
  expect(JSON.parse(keyBody)).toEqual({ account: 'employee', authSecret: 'fixture-gateway-secret', system: 'lingxi-office' })
  expect(console.info).toHaveBeenCalledWith('[company-login] personal key obtained')
})

it.each([{ ...callback, account: 'another-user' }, { ...callback, redirectUri: 'http://attacker.test/' }, { redirectUri: callback.redirectUri }])
('rejects client-selected identities and unregistered callbacks: %j', async (body) => {
  const upstream = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', upstream)
  const response = await send(await endpoint(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  expect(response.status).toBe(400)
  expect(upstream).not.toHaveBeenCalled()
})

it('contains upstream failures and never substitutes an unverified identity', async () => {
  const upstream = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: 'private-iam-token' }))
    .mockResolvedValueOnce(Response.json({ sub: '18000001' }))
  vi.stubGlobal('fetch', upstream)
  const response = await send(await endpoint(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(callback) })
  expect(response.status).toBe(502)
  expect(await response.json()).toEqual({ error: 'company_login_failed' })
  expect(upstream).toHaveBeenCalledTimes(2)
  expect(console.error).toHaveBeenCalledWith('[company-login] exchange failed', {
    stage: 'iam-userinfo', httpStatus: 200, errorCode: 'protocol',
  })
})

it.each([
  { stage: 'iam-token', responses: [new Response('private-token-error', { status: 401 })], httpStatus: 401 },
  { stage: 'gateway-key', responses: [Response.json({ access_token: 'private-iam-token' }),
    Response.json({ email: 'employee@example.test' }), new Response('private-gateway-error', { status: 404 })], httpStatus: 404 },
  { stage: 'iam-token', responses: [], httpStatus: undefined },
])('logs only fixed diagnostics when $stage fails', async ({ stage, responses, httpStatus }) => {
  const upstream = vi.fn<typeof fetch>()
  for (const response of responses) upstream.mockResolvedValueOnce(response)
  upstream.mockRejectedValue(new Error('private-request-secret'))
  vi.stubGlobal('fetch', upstream)
  const response = await send(await endpoint(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(callback) })
  expect(response.status).toBe(502)
  expect(console.error).toHaveBeenCalledExactlyOnceWith('[company-login] exchange failed', {
    stage, httpStatus, errorCode: httpStatus === undefined ? 'no-response' : 'network',
  })
  expect(console.info).not.toHaveBeenCalled()
})

it('refuses to start without both administrator-provided values', () => {
  expect(() => createCompanyLoginServer({ iamOrigin: 'https://iam-stg.haierxj.com', clientSecret: '', authSecret: 'fixture' }))
    .toThrow('requires both server deployment secrets')
})

it.each([
  { method: 'GET', type: 'application/json', body: undefined, status: 405 },
  { method: 'POST', type: 'text/plain', body: '{}', status: 415 },
  { method: 'POST', type: 'application/json', body: '{', status: 400 },
  { method: 'POST', type: 'application/json', body: 'x'.repeat(4097), status: 413 },
])('rejects invalid requests before contacting IAM: $status', async ({ method, type, body, status }) => {
  const upstream = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', upstream)
  const response = await send(await endpoint(), { method, headers: { 'content-type': type }, ...body === undefined ? {} : { body } })
  expect(response.status).toBe(status)
  expect(upstream).not.toHaveBeenCalled()
})
