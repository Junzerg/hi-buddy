/**
 * [hiBuddy] REAL composition spec: the Task 7 guard delegating to the real
 * hi-buddy-account-platform build against a real lingxi-server subprocess.
 * Everything is live — credential store, authorization seam, guard, delegate,
 * HTTP login protocol — except the browser step, which the dev IdP's autologin
 * replaces with one redirected GET.
 *
 * `HIBUDDY_TGZ=1` switches the delegate import from the built lib/ directory to
 * a freshly packed and unpacked tgz (CI / release verification); the default is
 * the directory build for the inner development loop.
 */
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer as createProbeServer } from 'node:net'
import { execa } from 'execa'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { AccountClientMetadata } from '@deepseek-ai/dsh-deepseek-account'
import { PlatformAccount } from '../src/index.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const lingxiServerDir = resolve(repoRoot, '../hi-buddy-kit-packages/lingxi-server')
const accountPlatformDir = resolve(repoRoot, '../hi-buddy-kit-packages/hi-buddy-account-platform')
const KEY = credentialKey('deepseek-account-platform', 'default')
const client: AccountClientMetadata = { version: '1.2.3', locale: 'zh-CN', timezoneOffsetSeconds: 0 }

/** The delegate surface this spec drives beyond the guard's own 14 methods. */
interface DelegateHandle {
  getSessionTicket(force?: boolean): Promise<string>
}

async function loadDelegateModule(): Promise<new (ctx: Context, config?: { endpoint?: string }) => DelegateHandle> {
  const modulePath = process.env.HIBUDDY_TGZ === '1'
    ? await packTgzModule()
    : join(accountPlatformDir, 'lib/index.js')
  const namespace = await import(pathToFileURL(modulePath).href) as { default?: unknown }
  return (typeof namespace === 'function' ? namespace : namespace.default) as never
}

/** npm pack + unpack the platform package; verifies the published artifact, not the build tree.
 *  The unpacked copy gets the source package's node_modules symlinked in — an install
 *  would provide the same workspace links (same trick as dev-web.spec.ts). */
async function packTgzModule(): Promise<string> {
  const packDir = await mkdtemp(join(tmpdir(), 'hibuddy-tgz-'))
  await execa('npm', ['pack', '--silent', '--pack-destination', packDir], { cwd: accountPlatformDir })
  await execa('tar', ['-xzf', join(packDir, 'hi-buddy-account-platform-0.1.0.tgz'), '-C', packDir])
  await symlink(join(accountPlatformDir, 'node_modules'), join(packDir, 'package/node_modules'), 'dir')
  return join(packDir, 'package/lib/index.js')
}

const HiBuddyAccount = await loadDelegateModule()

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })

function freePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createProbeServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolvePort(port))
    })
    probe.on('error', rejectPort)
  })
}

async function until(what: string, predicate: () => Promise<boolean> | boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${what}`)
}

it('真实全链：begin→flow 转发→autologin→poll→commit→面板→续期→登出', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hibuddy-real-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const mainPort = await freePort()
  const idpPort = await freePort()
  const origin = `http://127.0.0.1:${mainPort}`
  const server = execa(process.execPath, ['src/main.mjs'], {
    cwd: lingxiServerDir,
    env: {
      ...process.env,
      LINGXI_PORT: String(mainPort),
      LINGXI_IDP_PORT: String(idpPort),
      LINGXI_DB_PATH: join(root, 'lingxi.db'),
      LINGXI_KEYS_PATH: join(root, 'keys.json'),
      LINGXI_IDP_DEV_AUTOLOGIN_USER: 'dev',
    },
    stdout: 'pipe', stderr: 'pipe',
  })
  cleanups.push(async () => { server.kill(); await server.catch(() => undefined) })
  // /v1/connectors is session-authed (401 anonymous), so any HTTP response means the server is up.
  await until('lingxi-server to listen', async () => {
    const probe = await fetch(`${origin}/v1/connectors`, { signal: AbortSignal.timeout(500) }).catch(() => undefined)
    await probe?.body?.cancel().catch(() => {})
    return probe !== undefined
  }, 20_000)

  const ctx = new Context()
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(root, 'credentials.yaml'), watch: false })
  await credentials
  cleanups.push(() => credentials.dispose())
  const authorization = ctx.plugin(AuthorizationService)
  await authorization
  cleanups.push(() => authorization.dispose())
  // The real delegate, mounted through the Loader-style path the Host will use.
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
  cleanups.push(async () => { watchSignal.abort() })
  await until('succeeded phase', async () => (await account.getState()).attempt?.phase === 'succeeded', 10_000)

  // 3. The single-shot ticket committed through the seam into the shared store.
  const record = await ctx.credentials.readRecord(KEY)
  expect(record?.kind).toBe('grant')
  const storedTicket = (record as { payload: { token: string } } | undefined)?.payload?.token
  expect(typeof storedTicket).toBe('string')

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
  await until('initial watch frame', () => frames.length >= 1, 10_000)
  // Same-second HMAC tickets can be string-identical; cross the second boundary first.
  await new Promise(resolve => setTimeout(resolve, 1030 - (Date.now() % 1000)))
  const renewed = await delegate.getSessionTicket(true)
  expect(renewed).not.toBe(storedTicket)
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
