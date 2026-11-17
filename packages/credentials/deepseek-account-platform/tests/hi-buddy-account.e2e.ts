/**
 * Run with `DSH_HIBUDDY_E2E=1 pnpm run test:e2e hi-buddy-account` from paired
 * Host and kit checkouts. Install lingxi-server dependencies and build the
 * account kit first. `HIBUDDY_TGZ=1` exercises the packed kit entrypoint.
 */
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
  const server = execa(process.execPath, ['--input-type=module', '-e', `
    import { createServer } from './src/server.mjs'
    const [dbPath, keysPath] = process.argv.slice(1)
    const server = await createServer({ dbPath, keysPath, idpAutologinUser: 'dev' })
    await new Promise((resolve, reject) => process.send(server.url, error => error ? reject(error) : resolve()))
  `, join(root, 'lingxi.db'), join(root, 'keys.json')], {
    cwd: lingxiServerDir,
    ipc: true,
    reject: false,
    forceKillAfterDelay: 2_000,
  })
  cleanups.push(async () => { server.kill(); await server })
  const origin = await server.getOneMessage()
  if (typeof origin !== 'string') throw new Error('lingxi-server did not report an HTTP address')

  const ctx = new Context()
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(root, 'credentials.yaml'), watch: false })
  await credentials
  cleanups.push(() => credentials.dispose())
  const authorization = ctx.plugin(AuthorizationService)
  await authorization
  cleanups.push(() => authorization.dispose())
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
