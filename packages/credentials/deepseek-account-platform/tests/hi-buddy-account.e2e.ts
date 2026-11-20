/**
 * Run with `DSH_HIBUDDY_E2E=1 pnpm run test:e2e hi-buddy-account` from paired
 * Host and kit checkouts. Install hibuddy-server dependencies and build the
 * account kit first. `HIBUDDY_TGZ=1` exercises the packed kit entrypoint.
 */
import { afterEach, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer as createHttpServer } from 'node:http'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { AccountClientMetadata } from '@deepseek-ai/dsh-deepseek-account'
import { PlatformAccount } from '../src/index.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const hibuddyServerDir = resolve(repoRoot, '../hi-buddy-kit-packages/hibuddy-server')
const accountPlatformDir = resolve(repoRoot, '../hi-buddy-kit-packages/hi-buddy-account-platform')
const KEY = credentialKey('deepseek-account-platform', 'default')
const client: AccountClientMetadata = { version: '1.2.3', locale: 'zh-CN', timezoneOffsetSeconds: 0 }

/** The delegate surface this spec drives beyond the guard's own 14 methods. */
interface DelegateHandle {
  getSessionTicket(force?: boolean): Promise<string>
}

async function loadDelegateModule(root: string): Promise<new (ctx: Context, config?: { endpoint?: string }) => DelegateHandle> {
  const modulePath = process.env.HIBUDDY_TGZ === '1'
    ? await packTgzModule(root)
    : join(accountPlatformDir, 'lib/index.js')
  const namespace = await import(pathToFileURL(modulePath).href) as {
    default: new (ctx: Context, config?: { endpoint?: string }) => DelegateHandle
  }
  return namespace.default
}

async function packTgzModule(root: string): Promise<string> {
  const { stdout: filename } = await execa('npm', ['pack', '--silent', '--pack-destination', root], { cwd: accountPlatformDir })
  await execa('tar', ['-xzf', join(root, filename), '-C', root])
  await symlink(join(accountPlatformDir, 'node_modules'), join(root, 'package/node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  return join(root, 'package/lib/index.js')
}

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  const failures: unknown[] = []
  while (cleanups.length > 0) {
    try {
      await cleanups.pop()!()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures)
})

/** galois getOrCreate 的替身：同账号幂等，回固定 key + 单模型目录。
 *  校验方法、direct-target 头与 authSecret——server 侧漏发任何一项即 403，
 *  让 e2e 能抓住集成回归而非对一切回成功。 */
/** The JSON content type the galois stub answers every branch with. */
const JSON_HEADERS = { 'content-type': 'application/json' } as const

function startGaloisStub(): Promise<{ url: string; close(): Promise<void> }> {
  const upstream = createHttpServer((req, res) => {
    let raw = ''
    req.on('data', (chunk: string) => { raw += chunk })
    req.on('end', () => {
      let body: { account?: string; system?: string; authSecret?: string }
      try { body = JSON.parse(raw) as typeof body } catch {
        res.writeHead(400, JSON_HEADERS); res.end('{}'); return
      }
      if (req.method !== 'POST' || body.authSecret !== 'e2e-galois-secret'
        || req.headers['x-ploto-direct-target'] !== 'ploto-llm-admin-app') {
        res.writeHead(403, JSON_HEADERS); res.end('{}'); return
      }
      res.writeHead(200, JSON_HEADERS)
      res.end(JSON.stringify({
        success: true,
        status: { code: 20000 },
        data: {
          username: `${body.system}_${body.account}`,
          apiKey: 'sk-e2e-gateway-key',
          models: [{ modelName: 'deepseek-v3', contextLength: 65536, isMultimodal: false }],
          authorizedModels: ['deepseek-v3'],
        },
      }))
    })
  })
  return new Promise((resolve) => {
    upstream.listen(0, '127.0.0.1', () => {
      const address = upstream.address()
      if (address === null) throw new Error('galois stub failed to listen')
      const port = typeof address === 'object' ? address.port : Number(address)
      resolve({
        url: `http://127.0.0.1:${port}/ploto-llm-admin-app/api/internal/apiKey/getOrCreate`,
        close: () => new Promise((done) => { upstream.close(() => { done() }) }),
      })
    })
  })
}

/** gateway-key provisioning 的模型配置面（kit 的 configuration 阶段校验它）。 */
class GatewaySettingsStub extends Service {
  private readonly namespaces: Record<string, unknown>
  constructor(ctx: Context, namespaces: Record<string, unknown> = {}) {
    super(ctx, 'settings')
    this.namespaces = namespaces
  }
  describe(_options?: { redactSecrets?: boolean }): Array<{ ns: string; value?: unknown }> {
    return Object.entries(this.namespaces).map(([ns, value]) => ({ ns, value }))
  }
  /** 真实 settings 服务是 provider 层深合并（兄弟字段保留），替身保持一致。 */
  async update(ns: string, patch: { providers?: Record<string, Record<string, unknown>> }): Promise<unknown> {
    const current = (this.namespaces[ns] ?? {}) as { providers?: Record<string, Record<string, unknown>> }
    const providers = { ...current.providers }
    for (const [name, route] of Object.entries(patch.providers ?? {})) {
      providers[name] = { ...providers[name], ...route }
    }
    this.namespaces[ns] = { ...current, providers }
    return this.namespaces[ns]
  }
}

class GatewayDefaultModelStub extends Service {
  private selection: { provider?: string; model?: string } = {}
  constructor(ctx: Context) { super(ctx, 'agentDefaultModel') }
  currentSelection(): { provider?: string; model?: string } { return { ...this.selection } }
  async saveSelection(selection: { provider: string; model: string }): Promise<unknown> {
    this.selection = selection
    return { ...this.selection }
  }
}

async function until(what: string, predicate: () => Promise<boolean> | boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${what}`)
}

it.skipIf(process.env.DSH_HIBUDDY_E2E !== '1')('signs in, renews the session and signs out through the account adapter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hibuddy-account-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const HiBuddyAccount = await loadDelegateModule(root)
  // The login walk now provisions the gateway key mid-attempt, so the server
  // needs a galois upstream and the workspace needs the model configuration
  // plane the provisioning validates against.
  const galois = await startGaloisStub()
  cleanups.push(() => galois.close())
  const server = execa(process.execPath, ['--input-type=module', '-e', `
    import { createServer } from './src/server.mjs'
    const [dbPath, keysPath] = process.argv.slice(1)
    const galois = process.env.HIBUDDY_GALOIS_URL
      ? { url: process.env.HIBUDDY_GALOIS_URL, authSecret: process.env.HIBUDDY_GALOIS_AUTH_SECRET, system: 'lingxi-office' }
      : undefined
    const server = await createServer({ dbPath, keysPath, idpAutologinUser: 'dev', ...(galois ? { galois } : {}) })
    await new Promise((resolve, reject) => process.send(server.url, error => error ? reject(error) : resolve()))
  `, join(root, 'hibuddy.db'), join(root, 'keys.json')], {
    cwd: hibuddyServerDir,
    ipc: true,
    reject: false,
    forceKillAfterDelay: 2_000,
    env: { ...process.env, HIBUDDY_GALOIS_URL: galois.url, HIBUDDY_GALOIS_AUTH_SECRET: 'e2e-galois-secret' },
  })
  cleanups.push(async () => { server.kill(); await server })
  const origin = await server.getOneMessage()
  if (typeof origin !== 'string') throw new Error('hibuddy-server did not report an HTTP address')

  const ctx = new Context()
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(root, 'credentials.yaml'), watch: false })
  await credentials
  cleanups.push(() => credentials.dispose())
  const authorization = ctx.plugin(AuthorizationService)
  await authorization
  cleanups.push(() => authorization.dispose())
  const settingsFiber = ctx.plugin(GatewaySettingsStub, {
    'llm-pi-ai': { providers: { 'company-gateway': {
      displayName: 'HaierCash', apiKeyEnv: 'COMPANY_GATEWAY_API_KEY', accountRequired: true,
      api: 'anthropic-messages', baseURL: 'http://ai-gateway.haierxj.cn', models: [],
    } } },
  })
  await settingsFiber
  cleanups.push(() => settingsFiber.dispose())
  const defaultsFiber = ctx.plugin(GatewayDefaultModelStub)
  await defaultsFiber
  cleanups.push(() => defaultsFiber.dispose())
  const delegateFiber = ctx.plugin(HiBuddyAccount, { endpoint: origin })
  await delegateFiber
  const delegate = ctx.get('hiBuddyAccount') as DelegateHandle
  cleanups.push(() => delegateFiber.dispose())
  const provider = ctx.plugin(PlatformAccount, { hiBuddyLogin: true, allowLoopbackHttp: true, requestTimeoutMs: 10_000 })
  await provider
  cleanups.push(() => provider.dispose())
  const account = ctx.deepseekAccount as PlatformAccount

  // 1. Sign-in through the guard: the delegate drives the seam, the guard's flow forwards back.
  const started = await account.startSignIn(client, 'http://127.0.0.1:3080', 'web')
  expect(started.attempt).toBeDefined()
  await until('waiting-browser phase', async () => (await account.getState()).attempt?.phase === 'waiting-browser', 10_000)
  const waiting = await account.getState()
  expect(waiting.attempt!.authorizeUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+/)

  // 2. Headless browser step: the dev IdP autologin issues the code and the
  //    followed redirect lands on /v1/auth/callback, completing the transaction.
  const browser = await fetch(waiting.attempt!.authorizeUrl!, { redirect: 'follow' })
  expect(browser.ok).toBe(true)
  await browser.body?.cancel().catch(() => {})

  const watchSignal = new AbortController()
  await until('succeeded phase', async () => (await account.getState()).attempt?.phase === 'succeeded', 10_000)

  // 3. The single-shot ticket committed through the seam into the shared store.
  const record = await ctx.credentials.readRecord(KEY)
  expect(record?.kind).toBe('grant')
  const storedTicket = (record as { payload: { token: string } } | undefined)?.payload?.token
  expect(typeof storedTicket).toBe('string')

  // 3b. The gateway key provisioned and the catalog wired into the model plane.
  const settings = ctx.get('settings') as unknown as GatewaySettingsStub
  const wired = (settings.describe()[0]?.value as { providers?: Record<string, { models?: unknown[] }> })
    ?.providers?.['company-gateway']?.models ?? []
  expect(wired).toEqual([{ id: 'deepseek-v3', name: 'deepseek-v3', contextWindow: 65536, input: ['text'] }])

  // 3c. The default-model selection and the stored key ref land too.
  const defaults = ctx.get('agentDefaultModel') as unknown as GatewayDefaultModelStub
  expect(defaults.currentSelection()).toEqual({ provider: 'company-gateway', model: 'deepseek-v3' })
  const storedKey = await (ctx.get('credentials') as unknown as {
    resolve(ref: string): Promise<{ value?: string } | undefined>
  }).resolve(credentialRef('COMPANY_GATEWAY_API_KEY'))
  expect(storedKey?.value).toBe('sk-e2e-gateway-key')

  const state = await account.getState()
  expect(state.status).toBe('credential-stored')
  expect(state.authenticationMethod).toBe('iam')

  // 4. Task 1's name claim reaches the account panel profile.
  const profile = await account.getProfile(client)
  expect(profile).toMatchObject({ status: 'ready', value: { name: 'Dev 用户' } })

  // 5. Renewal through the real chain: force-refresh mints a different ticket,
  //    the store record follows, and watch consumers receive a refresh frame.
  const frames: Array<{ status: string }> = []
  const collector = (async () => {
    for await (const frame of account.watch(watchSignal.signal)) frames.push({ status: frame.status })
  })()
  cleanups.push(async () => { watchSignal.abort(); await collector })
  await until('initial watch frame', () => frames.length >= 1, 10_000)
  let renewed: string | undefined
  await until('a distinct renewed ticket', async () => {
    renewed = await delegate.getSessionTicket(true)
    return renewed !== storedTicket
  }, 5_000)
  const afterRenew = await ctx.credentials.readRecord(KEY)
  expect((afterRenew as { payload: { token: string } } | undefined)?.payload?.token).toBe(renewed)
  await until('renewal watch frame', () => frames.length >= 2, 10_000)

  // 6. Sign-out through the guard clears the record and kills the server session.
  const signedOut = await account.signOut(client)
  expect(signedOut.status).toBe('signed-out')
  expect(await ctx.credentials.readRecord(KEY)).toBeUndefined()
  const renewalAfterLogout = await fetch(`${origin}/v1/auth/renew`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionToken: renewed }),
  })
  expect(renewalAfterLogout.status).toBe(401)
  await renewalAfterLogout.body?.cancel().catch(() => {})
  await until('signed-out watch frame', () => frames.some(frame => frame.status === 'signed-out'), 10_000)

  watchSignal.abort()
  await collector
}, 60_000)
