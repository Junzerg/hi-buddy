/** [hiBuddy] Guard delegation specs: hiBuddyLogin unset must be byte-identical,
 * set must forward the whole account surface plus the three seams to the
 * hiBuddyAccount service (hi-buddy-account-platform). */
import { afterEach, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { AccountClientMetadata } from '@deepseek-ai/dsh-deepseek-account'
import { PlatformAccount } from '../src/index.ts'

const KEY = credentialKey('deepseek-account-platform', 'default')
const client: AccountClientMetadata = { version: '1.2.3', locale: 'zh-CN', timezoneOffsetSeconds: 0 }

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })

/** Spy standing in for hi-buddy-account-platform's mounted service. */
class HiBuddyAccountSpy extends Service {
  readonly calls = new Map<string, unknown[][]>()
  readonly returns = new Map<string, unknown>()
  constructor(ctx: Context) {
    super(ctx, 'hiBuddyAccount')
    for (const name of ['getState', 'getProfile', 'getBalance', 'getUnnotifiedBonuses', 'ackBonusNotified',
      'startSignIn', 'completeApiKeySignIn', 'cancelSignIn', 'signOut', 'watch', 'resolveToken', 'rejectToken',
      'getPlatformSession', 'getDeviceIdentity', 'handleAuthorizationRun', 'notifyRecordUpdated', 'getSessionTicket']) {
      this.calls.set(name, [])
      this.returns.set(name, undefined)
    }
  }
  private record(name: string, args: unknown[]): unknown {
    this.calls.get(name)!.push(args)
    const outcome = this.returns.get(name)
    // The real delegate's methods are async; only run-shaped values stay unwrapped.
    return typeof outcome === 'function' ? (outcome as () => unknown)() : Promise.resolve(outcome)
  }
  readonly getState = () => this.record('getState', [])
  readonly getProfile = (c: unknown) => this.record('getProfile', [c])
  readonly getBalance = (c: unknown) => this.record('getBalance', [c])
  readonly getUnnotifiedBonuses = (c: unknown) => this.record('getUnnotifiedBonuses', [c])
  readonly ackBonusNotified = (a: unknown, o: unknown, c: unknown) => this.record('ackBonusNotified', [a, o, c])
  readonly startSignIn = (c: unknown, o: unknown, s: unknown) => this.record('startSignIn', [c, o, s])
  readonly completeApiKeySignIn = (k: unknown) => this.record('completeApiKeySignIn', [k])
  readonly cancelSignIn = (id: unknown) => this.record('cancelSignIn', [id])
  readonly signOut = (c: unknown) => this.record('signOut', [c])
  readonly watch = (signal: unknown) => this.record('watch', [signal])
  readonly resolveToken = (u: unknown) => this.record('resolveToken', [u])
  readonly rejectToken = (t: unknown) => this.record('rejectToken', [t])
  readonly getPlatformSession = () => this.record('getPlatformSession', [])
  readonly getDeviceIdentity = () => this.record('getDeviceIdentity', [])
  readonly handleAuthorizationRun = (s: unknown) => this.record('handleAuthorizationRun', [s])
  readonly notifyRecordUpdated = () => this.record('notifyRecordUpdated', [])
  readonly getSessionTicket = (f: unknown) => this.record('getSessionTicket', [f])
  count(name: string): number { return this.calls.get(name)!.length }
  total(): number { return [...this.calls.values()].reduce((sum, calls) => sum + calls.length, 0) }
}

interface FixtureOptions {
  hiBuddyLogin?: boolean
  mountSpy?: boolean
  presetHibuddyGrant?: boolean
}

async function fixture({ hiBuddyLogin, mountSpy, presetHibuddyGrant }: FixtureOptions = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-guard-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  const authorization = ctx.plugin(AuthorizationService)
  await authorization
  if (presetHibuddyGrant) {
    await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({
      kind: 'grant', payload: { version: 1, token: 'hibuddy-session-ticket', issuer: 'http://127.0.0.1:18881' },
    }))
  }
  let spy: HiBuddyAccountSpy | undefined
  if (mountSpy) {
    const spyFiber = ctx.plugin(HiBuddyAccountSpy)
    await spyFiber
    spy = ctx.get('hiBuddyAccount') as HiBuddyAccountSpy
  }
  const provider = ctx.plugin(PlatformAccount, hiBuddyLogin === undefined ? {} : { hiBuddyLogin })
  await provider
  const account = ctx.deepseekAccount as PlatformAccount
  cleanups.push(async () => { await provider.dispose(); await authorization.dispose(); await credentials.dispose() })
  return { ctx, account, spy: spy! }
}

it('hiBuddyLogin unset: zero delegation — the spy service is never touched (byte-identical default path)', async () => {
  const { account, spy } = await fixture({ mountSpy: true })
  const initial = await account.getState()
  expect(initial).toEqual({
    status: 'signed-out',
    attempt: null,
    links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
  })
  await account.getProfile(client)
  await account.getBalance(client)
  await account.getUnnotifiedBonuses(client)
  await account.ackBonusNotified('u1' as never, 'o1' as never, client)
  const started = await account.startSignIn(client, 'http://localhost:3000', 'web')
  await account.cancelSignIn(started.attempt!.id)
  await account.resolveToken('https://api.deepseek.com/v1/chat')
  await account.rejectToken('not-stored')
  await account.getPlatformSession()
  await account.getDeviceIdentity()
  const watchSignal = new AbortController()
  for await (const _view of account.watch(watchSignal.signal)) break
  watchSignal.abort()
  await expect(account.completeApiKeySignIn('sk-x')).rejects.toThrow()
  await account.signOut(client)
  expect(spy.total()).toBe(0)
})

it('hiBuddyLogin: true → the 14 public methods forward verbatim arguments and return values', async () => {
  const { account, spy } = await fixture({ hiBuddyLogin: true, mountSpy: true })
  const stateView = { status: 'credential-stored' as const, attempt: null, links: { usageUrl: 'http://127.0.0.1:18881', topUpUrl: 'http://127.0.0.1:18881' } }
  const startView = { status: 'signed-out' as const, attempt: { id: 'a1' as never, phase: 'waiting-browser' as const }, links: stateView.links }
  spy.returns.set('getState', stateView)
  spy.returns.set('getProfile', { status: 'ready', value: { id: null, name: '谢', contact: null, avatarUrl: null } })
  spy.returns.set('getBalance', { status: 'ready', value: { amount: '0' } })
  spy.returns.set('getUnnotifiedBonuses', { accountId: 'u1', bonuses: [] })
  spy.returns.set('ackBonusNotified', true)
  spy.returns.set('startSignIn', startView)
  spy.returns.set('completeApiKeySignIn', undefined)
  spy.returns.set('cancelSignIn', stateView)
  spy.returns.set('signOut', stateView)
  spy.returns.set('resolveToken', 'hibuddy-ticket')
  spy.returns.set('rejectToken', undefined)
  spy.returns.set('getPlatformSession', null)
  spy.returns.set('getDeviceIdentity', { osVersion: 'darwin 25' })
  spy.returns.set('watch', () => (async function* () { yield startView })())

  await expect(account.getState()).resolves.toBe(stateView)
  await expect(account.getProfile(client)).resolves.toBe(spy.returns.get('getProfile'))
  await expect(account.getBalance(client)).resolves.toBe(spy.returns.get('getBalance'))
  await expect(account.getUnnotifiedBonuses(client)).resolves.toBe(spy.returns.get('getUnnotifiedBonuses'))
  await expect(account.ackBonusNotified('u1' as never, 'o1' as never, client)).resolves.toBe(true)
  await expect(account.startSignIn(client, 'http://localhost:3000', 'desktop')).resolves.toBe(startView)
  await expect(account.completeApiKeySignIn('sk-x')).resolves.toBeUndefined()
  await expect(account.cancelSignIn('a1' as never)).resolves.toBe(stateView)
  await expect(account.signOut(client)).resolves.toBe(stateView)
  await expect(account.resolveToken('https://api.deepseek.com/v1/chat')).resolves.toBe('hibuddy-ticket')
  await expect(account.rejectToken('hibuddy-ticket')).resolves.toBeUndefined()
  await expect(account.getPlatformSession()).resolves.toBeNull()
  await expect(account.getDeviceIdentity()).resolves.toEqual({ osVersion: 'darwin 25' })
  const watchSignal = new AbortController()
  const watched = account.watch(watchSignal.signal)
  await expect(watched[Symbol.asyncIterator]().next()).resolves.toMatchObject({ value: startView })
  watchSignal.abort()

  expect(spy.calls.get('getProfile')).toEqual([[client]])
  expect(spy.calls.get('getBalance')).toEqual([[client]])
  expect(spy.calls.get('getUnnotifiedBonuses')).toEqual([[client]])
  expect(spy.calls.get('ackBonusNotified')).toEqual([['u1', 'o1', client]])
  expect(spy.calls.get('startSignIn')).toEqual([[client, 'http://localhost:3000', 'desktop']])
  expect(spy.calls.get('completeApiKeySignIn')).toEqual([['sk-x']])
  expect(spy.calls.get('cancelSignIn')).toEqual([['a1']])
  expect(spy.calls.get('signOut')).toEqual([[client]])
  expect(spy.calls.get('resolveToken')).toEqual([['https://api.deepseek.com/v1/chat']])
  expect(spy.calls.get('rejectToken')).toEqual([['hibuddy-ticket']])
})

it('authorization flow run forwards handleAuthorizationRun; record-updated forwards notifyRecordUpdated', async () => {
  const { ctx, spy } = await fixture({ hiBuddyLogin: true, mountSpy: true })
  const deferred = Promise.withResolvers<undefined>()
  spy.returns.set('handleAuthorizationRun', () => deferred.promise)
  const signal = new AbortController()
  const settled = ctx.authorization.begin({
    key: KEY,
    signal: signal.signal,
    interaction: { notify: () => undefined, prompt: () => Promise.reject(new Error('no prompt')) },
  })
  await vi.waitFor(() => { expect(spy.count('handleAuthorizationRun')).toBe(1) })
  const session = spy.calls.get('handleAuthorizationRun')![0]![0] as Record<string, unknown>
  expect(typeof session.commit).toBe('function')
  expect((session.signal as AbortSignal).aborted).toBe(false)
  deferred.resolve(undefined)
  // Resolving without session.commit is the seam's NOT_COMMITTED rejection — the real
  // delegate commits before resolving; here only the forwarding itself is under test.
  await expect(settled).rejects.toThrow('resolved without committing')

  ctx.emit('credentials/record-updated', KEY)
  expect(spy.count('notifyRecordUpdated')).toBe(1)
  ctx.emit('credentials/record-updated', credentialKey('deepseek-account-platform', 'device'))
  expect(spy.count('notifyRecordUpdated')).toBe(1)
})

it('init keeps a hibuddy grant under hiBuddyLogin and still deletes foreign grants without the key', async () => {
  const kept = await fixture({ hiBuddyLogin: true, mountSpy: true, presetHibuddyGrant: true })
  expect(await kept.ctx.credentials.readRecord(KEY)).toMatchObject({
    kind: 'grant', payload: { token: 'hibuddy-session-ticket', issuer: 'http://127.0.0.1:18881' },
  })

  const legacy = await fixture({ presetHibuddyGrant: true })
  expect(await legacy.ctx.credentials.readRecord(KEY)).toBeUndefined()
})

it('hiBuddyLogin and companyLogin together are rejected at construction', () => {
  expect(() => new PlatformAccount(new Context(), {
    hiBuddyLogin: true, companyLogin: true, companyLoginEndpoint: 'https://versions.example',
  })).toThrow('mutually exclusive')
})

it('hiBuddyLogin without the mounted plugin fails on first use with a repair hint', async () => {
  const { account } = await fixture({ hiBuddyLogin: true })
  await expect(account.getState()).rejects.toThrow(/hi-buddy-account-platform/)
})
