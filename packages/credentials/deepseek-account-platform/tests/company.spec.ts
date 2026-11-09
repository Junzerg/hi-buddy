/** Company protocol and shared key completion without intranet access. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Authorization from '@deepseek-ai/dsh-authorization'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { PlatformAccount } from '../src/index.ts'
import { companyAccountProfile, companyAuthorizeUrl, exchangeCompanyIdentity, exchangeCompanyLogin, COMPANY_KEY_REF, COMPANY_KEY_URL } from '../src/company.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  while (cleanups.length) await cleanups.pop()?.()
})

it.each(['model-discovery', 'model-settings', 'default-model', 'credential-save', 'rollback'] as const)
('reports the failed IAM activation stage without exposing exception secrets: %s', async (stage) => {
  const f = await keyFixture()
  const failure = new Error('private-key fixture-code private-response')
  if (stage === 'model-discovery') f.discover.mockRejectedValueOnce(failure)
  if (stage === 'model-settings') f.update.mockRejectedValueOnce(failure)
  if (stage === 'default-model') f.save.mockRejectedValueOnce(failure)
  if (stage === 'credential-save') vi.spyOn(f.ctx.credentials, 'set').mockRejectedValueOnce(failure)
  if (stage === 'rollback') f.update.mockRejectedValue(failure)
  const logs = vi.spyOn(console, 'error').mockImplementation(() => {})
  const send = globalThis.fetch
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (input === f.accountConfig.companyLoginEndpoint) {
      return Promise.resolve(Response.json({ apiKey: 'private-key', account: 'employee', email: 'employee@example.test' }))
    }
    return send(input, init)
  })
  const lifetime = new AbortController()
  cleanups.push(async () => { lifetime.abort() })
  const account = f.ctx.deepseekAccount
  const wait = async (phase: string) => {
    for await (const view of account.watch(lifetime.signal)) {
      if (view.attempt?.phase === phase) return view
      if (view.attempt?.phase === 'failed') throw new Error('sign-in failed before the expected phase')
    }
    throw new Error(`missing phase ${phase}`)
  }
  await account.startSignIn({ version: 'test', locale: 'en', timezoneOffsetSeconds: 0 }, f.ctx.webServer.getOrigin(), 'desktop')
  const waiting = await wait('waiting-browser')
  const authorize = new URL(waiting.attempt!.authorizeUrl!)
  const callback = new URL(authorize.searchParams.get('redirect_uri')!)
  callback.search = new URLSearchParams({ code: 'fixture-code', state: authorize.searchParams.get('state')! }).toString()
  await fetch(callback, { redirect: 'manual' })
  const failed = await wait('failed')
  expect(failed).toMatchObject({ status: 'signed-out', attempt: { phase: 'failed', errorCode: 'protocol', errorStage: stage } })
  expect(JSON.stringify(failed)).not.toContain('private-key')
  expect(logs).toHaveBeenCalledWith('[deepseek-account] sign-in failed', { errorCode: 'protocol', errorStage: stage })
  expect(JSON.stringify(logs.mock.calls)).not.toContain(failure.message)
  expect(await f.ctx.credentials.resolve(credentialRef(COMPANY_KEY_REF))).toBeUndefined()
})

it('constructs authorization from the original callback origin without exposing deployment secrets', () => {
  const url = new URL(companyAuthorizeUrl('https://iam-stg.haierxj.com', 'http://127.0.0.1:18743/oauth/callback', 'fixture-state'))
  expect(url.pathname).toBe('/sso/oauth2/authorize')
  expect(url.searchParams.get('client_id')).toBe('APP176')
  expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:18743/oauth/callback')
  expect(url.searchParams.get('state')).toBe('fixture-state')
  expect(url.searchParams.has('client_secret')).toBe(false)
})

it('submits only the authorization code and registered callback to the versions server', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ apiKey: 'personal-key', account: 'employee', email: 'employee@example.test' }))
  vi.stubGlobal('fetch', send)
  await expect(exchangeCompanyLogin('http://172.28.236.3:18765/company-login/exchange',
    'http://127.0.0.1:18743/oauth/callback', 'fixture-code', new AbortController().signal))
    .resolves.toEqual({ apiKey: 'personal-key', account: 'employee', email: 'employee@example.test' })
  expect(send.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ code: 'fixture-code', redirectUri: 'http://127.0.0.1:18743/oauth/callback' }))
})

it('requests the verified email account in lingxi-office and accepts its system-prefixed gateway username', async () => {
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: 'fixture-token' }))
    .mockResolvedValueOnce(Response.json({ email: 'Employee.Name@example.test', sub: '18000001' }))
    .mockResolvedValueOnce(Response.json({ success: true, status: { code: 20000, description: 'OK' }, msg: null, extraInfo: {},
      data: { username: 'lingxi-office_Employee.Name', apiKey: 'fixture-key', newlyCreated: false, authorizedModels: ['fixture-model'] } }))
  vi.stubGlobal('fetch', send)
  expect(await exchangeCompanyIdentity('https://iam-stg.haierxj.com', 'http://127.0.0.1:18743/oauth/callback',
    'fixture-code', 'fixture-client-secret', 'fixture-auth-secret', new AbortController().signal))
    .toEqual({ apiKey: 'fixture-key', account: 'Employee.Name', email: 'Employee.Name@example.test' })
  expect(send.mock.calls[2]?.[0]).toBe(COMPANY_KEY_URL)
  expect(new Headers(send.mock.calls[2]?.[1]?.headers).get('X-Ploto-Direct-Target')).toBe('ploto-llm-admin-app')
  expect(new Headers(send.mock.calls[0]?.[1]?.headers).has('X-Ploto-Direct-Target')).toBe(false)
  expect(new Headers(send.mock.calls[1]?.[1]?.headers).has('X-Ploto-Direct-Target')).toBe(false)
  const body = send.mock.calls[2]?.[1]?.body
  if (typeof body !== 'string') throw new Error('expected a JSON request body')
  expect(JSON.parse(body)).toEqual({ account: 'Employee.Name', authSecret: 'fixture-auth-secret', system: 'lingxi-office' })
})

it.each([
  { orgPathName: '/示例公司/金融科技中心/架构平台/', orgName: 'AI工程', expected: '金融科技中心 / 架构平台 / AI工程' },
  { orgPathName: ' /示例公司//金融科技中心/架构平台/ ', orgName: ' AI工程 ', expected: '金融科技中心 / 架构平台 / AI工程' },
  { orgPathName: '/示例公司/', orgName: 'AI工程', expected: 'AI工程' },
  { orgPathName: '', orgName: 'AI工程', expected: 'AI工程' },
])('combines IAM parent organizations with the current organization: $orgPathName', ({ orgPathName, orgName, expected }) => {
  expect(companyAccountProfile({ apiKey: 'fixture-key', account: 'employee', email: 'employee@example.test',
    name: ' 张宁 ', orgName, orgPathName })).toEqual({
    id: null, name: '张宁', contact: 'employee@example.test', department: expected,
  })
})

it('retains the email-account fallback for a login server without display fields', () => {
  expect(companyAccountProfile({ apiKey: 'fixture-key', account: 'employee', email: 'employee@example.test' }))
    .toEqual({ id: null, name: 'employee', contact: 'employee@example.test' })
})

it('accepts only the three company display fields from the login server', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
    apiKey: 'fixture-key', account: 'employee', email: 'employee@example.test', name: '张宁',
    orgName: 'AI工程', orgPathName: '/示例公司/金融科技中心/架构平台/', telephone: 'private-phone', card: 'private-card',
  })))
  expect(await exchangeCompanyLogin('http://127.0.0.1/company-login/exchange', 'http://127.0.0.1:18743/oauth/callback',
    'code', new AbortController().signal)).toEqual({
    apiKey: 'fixture-key', account: 'employee', email: 'employee@example.test', name: '张宁',
    orgName: 'AI工程', orgPathName: '/示例公司/金融科技中心/架构平台/',
  })
})

it.each([undefined, '', 'employee', '@company.test', 'employee@', 'a@b@c', ' employee@company.test'])
('rejects absent or malformed email without substituting employee numbers: %j', async (email) => {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: 'token' }))
    .mockResolvedValueOnce(Response.json({ email, sub: '18000001', sn: '18000001' }))
  vi.stubGlobal('fetch', send)
  await expect(exchangeCompanyIdentity('https://iam-stg.haierxj.com', 'http://127.0.0.1:18743/oauth/callback',
    'code', 'client', 'auth', new AbortController().signal)).rejects.toMatchObject({ code: 'protocol' })
  expect(send).toHaveBeenCalledTimes(2)
})

it.each(['lingxi-office_other', 'another-system_employee', 'employee'])('rejects credentials outside the requested system account: %s', async (username) => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: 'token' }))
    .mockResolvedValueOnce(Response.json({ email: 'employee@company.test' }))
    .mockResolvedValueOnce(Response.json({ success: true, status: { code: 20000 }, data: { username, apiKey: 'private-key' } })))
  await expect(exchangeCompanyIdentity('https://iam-stg.haierxj.com', 'http://127.0.0.1:18743/oauth/callback',
    'code', 'client', 'auth', new AbortController().signal)).rejects.toMatchObject({ code: 'protocol' })
})

async function keyFixture(api = 'anthropic-messages') {
  const home = await mkdtemp(join(tmpdir(), 'company-key-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await ctx.plugin(Authorization)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const discover = vi.fn(async () => [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }])
  const update = vi.fn(async () => {})
  let selection = { provider: 'company-gateway', model: 'second' }
  const save = vi.fn(async (next: typeof selection) => { selection = next })
  ctx.provide('llm', { discoverModels: discover } as never)
  ctx.provide('settings', { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { 'company-gateway': {
    api, baseURL: 'http://ai-gateway.haierxj.cn', apiKeyEnv: COMPANY_KEY_REF,
  } } } }], update } as never)
  ctx.provide('agentDefaultModel', { currentSelection: () => selection, saveSelection: save } as never)
  const accountConfig = { companyLogin: true, platformOrigin: 'https://iam-stg.haierxj.com',
    inferenceOrigin: 'http://ai-gateway.haierxj.cn',
    companyLoginEndpoint: 'http://172.28.236.3:18765/company-login/exchange' }
  const accountFiber = await ctx.plugin(PlatformAccount, accountConfig)
  return { ctx, discover, update, save, accountFiber, accountConfig }
}

it.each(['anthropic-messages', 'openai-completions'])('completes manual keys through %s and preserves an available default', async (api) => {
  const f = await keyFixture(api)
  await f.ctx.deepseekAccount.completeApiKeySignIn('fixture-key')
  expect(await f.ctx.deepseekAccount.getState()).toMatchObject({ status: 'credential-stored', authenticationMethod: 'api-key' })
  expect(f.discover).toHaveBeenCalledWith('llm-pi-ai', {
    api, baseURL: 'http://ai-gateway.haierxj.cn', apiKey: 'fixture-key',
  }, expect.any(AbortSignal))
  expect(f.save).toHaveBeenCalledExactlyOnceWith({ provider: 'company-gateway', model: 'second' })
  expect((await f.ctx.credentials.resolve(credentialRef(COMPANY_KEY_REF)))?.value).toBe('fixture-key')
})

it('does not accept empty discovery, and does not retain a key after a configuration write fails', async () => {
  const f = await keyFixture()
  f.discover.mockResolvedValueOnce([])
  await expect(f.ctx.deepseekAccount.completeApiKeySignIn('fixture-key')).rejects.toMatchObject({ code: 'protocol' })
  expect(f.update).not.toHaveBeenCalled()
  f.update.mockRejectedValueOnce(new Error('local write failed'))
  await expect(f.ctx.deepseekAccount.completeApiKeySignIn('fixture-key')).rejects.toThrow('local write failed')
  expect(await f.ctx.credentials.resolve(credentialRef(COMPANY_KEY_REF))).toBeUndefined()
})

it('clears company credentials, synchronized models and the default model on sign-out', async () => {
  const f = await keyFixture()
  await f.ctx.deepseekAccount.completeApiKeySignIn('fixture-key')
  expect((await f.ctx.deepseekAccount.getState()).status).toBe('credential-stored')
  expect(await f.ctx.deepseekAccount.resolveToken('http://ai-gateway.haierxj.cn/v1')).toBe('fixture-key')
  await f.ctx.credentials.set(credentialRef(COMPANY_KEY_REF), 'replaced-key')
  await f.ctx.deepseekAccount.signOut({ version: 'test', locale: 'en', timezoneOffsetSeconds: 0 })
  expect(await f.ctx.credentials.resolve(credentialRef(COMPANY_KEY_REF))).toBeUndefined()
  expect(await f.ctx.credentials.readRecord(credentialKey('deepseek-account-platform', 'default'))).toBeUndefined()
  expect(f.update).toHaveBeenLastCalledWith('llm-pi-ai', { providers: { 'company-gateway': { models: [] } } })
  expect(f.save).toHaveBeenLastCalledWith({ provider: 'company-gateway', model: '' })
  expect((await f.ctx.deepseekAccount.getState()).status).toBe('signed-out')
  expect(await f.ctx.deepseekAccount.resolveToken('http://ai-gateway.haierxj.cn/v1')).toBeUndefined()
})

it('waits for admitted key synchronization before clearing company access on sign-out', async () => {
  const f = await keyFixture()
  const discovered = Promise.withResolvers<{ id: string; name: string }[]>()
  const started = Promise.withResolvers<undefined>()
  f.discover.mockImplementationOnce(() => { started.resolve(undefined); return discovered.promise })
  const signingIn = f.ctx.deepseekAccount.completeApiKeySignIn('fixture-key')
  await started.promise
  const signingOut = f.ctx.deepseekAccount.signOut({ version: 'test', locale: 'en', timezoneOffsetSeconds: 0 })
  discovered.resolve([{ id: 'first', name: 'First' }])
  await signingIn
  await signingOut
  expect(await f.ctx.credentials.resolve(credentialRef(COMPANY_KEY_REF))).toBeUndefined()
  expect((await f.ctx.deepseekAccount.getState()).status).toBe('signed-out')
})

it('restores company display data after provider restart and clears it before the next login', async () => {
  const f = await keyFixture()
  const send = globalThis.fetch
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : typeof input === 'string' ? input : input.href
    if (url === 'http://172.28.236.3:18765/company-login/exchange') {
      return Promise.resolve(Response.json({ apiKey: 'fixture-key', account: 'employee', email: 'employee@example.test',
        name: '张宁', orgName: 'AI工程', orgPathName: '/示例公司/金融科技中心/架构平台/' }))
    }
    return send(input, init)
  })
  let account = f.ctx.deepseekAccount
  const client = { version: 'test', locale: 'en', timezoneOffsetSeconds: 0 }
  const callbackOrigin = f.ctx.webServer.getOrigin()
  const lifetime = new AbortController()
  cleanups.push(async () => { lifetime.abort() })
  const wait = async (phase: string) => {
    for await (const view of account.watch(lifetime.signal)) {
      expect(view.attempt?.phase).not.toBe('failed')
      if (view.attempt?.phase === phase) return view
    }
    throw new Error(`missing phase ${phase}`)
  }
  let previousState: string | null = null
  for (let index = 0; index < 2; index++) {
    await account.startSignIn(client, callbackOrigin, 'desktop')
    const view = await wait('waiting-browser')
    const authorize = new URL(view.attempt!.authorizeUrl!)
    expect(authorize.searchParams.get('state')).not.toBe(previousState)
    previousState = authorize.searchParams.get('state')
    const callback = new URL(authorize.searchParams.get('redirect_uri')!)
    callback.search = new URLSearchParams({ code: 'fixture-code', state: previousState! }).toString()
    expect((await fetch(callback, { redirect: 'manual' })).status).toBe(302)
    expect(await wait('succeeded')).toMatchObject({ status: 'credential-stored', authenticationMethod: 'iam' })
    const profile = { status: 'ready', value: { id: null, name: '张宁', contact: 'employee@example.test',
      department: '金融科技中心 / 架构平台 / AI工程' } }
    expect(await account.getProfile(client)).toEqual(profile)
    if (index === 0) {
      await f.accountFiber.dispose()
      await f.ctx.plugin(PlatformAccount, f.accountConfig)
      account = f.ctx.deepseekAccount
      expect(await account.getProfile(client)).toEqual(profile)
      expect(await account.getState()).toMatchObject({ authenticationMethod: 'iam', attempt: null })
    }
    await account.signOut(client)
    expect(await account.getProfile(client)).toBeNull()
    expect(await f.ctx.credentials.resolve(credentialRef(COMPANY_KEY_REF))).toBeUndefined()
  }
  expect(f.discover).toHaveBeenCalledTimes(2)
})
