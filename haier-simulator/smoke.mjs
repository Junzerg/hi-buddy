/** Exercise a running simulator-configured Web Host through its real account RPC and callback. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function verifyWeb(startupUrl) {
  const url = new URL(startupUrl)
  if (url.origin !== 'http://127.0.0.1:18743') throw new Error('Use the simulator Web Host startup URL on 127.0.0.1:18743')
  const landing = await fetch(url, { redirect: 'manual' })
  assert.equal(landing.status, 303)
  const cookie = landing.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  await landing.body?.cancel()
  const index = await fetch(new URL('/', url), { headers: { cookie } })
  assert.equal(index.status, 200)
  assert.ok((await index.text()).includes('__DSH_REQUIRE_IAM_LOGIN__'), 'Web bootstrap must enable the mandatory IAM entry')
  const rpc = async (method, args = {}) => {
    const response = await fetch(new URL(`/api/${method}`, url), {
      method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }),
    })
    assert.equal(response.status, 200)
    const envelope = await response.json()
    assert.equal(envelope.result.ok, true, `${method} failed`)
    return envelope.result.value
  }
  const initial = await rpc('account/getState')
  assert.equal(new URL(initial.links.usageUrl).hostname, '127.0.0.1', 'Refusing to change an account outside the local simulator')
  const simulator = await fetch(new URL('/health', initial.links.usageUrl))
  assert.equal((await simulator.json()).service, 'haier-simulator')
  const client = { version: 'haier-simulator', locale: 'zh-CN', timezoneOffsetSeconds: 0 }
  const wait = async predicate => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const state = await rpc('account/getState')
      if (predicate(state)) return state
      await new Promise(accept => setTimeout(accept, 50))
    }
    throw new Error('Account state did not settle within 15 seconds')
  }
  try {
    await rpc('account/signOut', { client })
    await rpc('account/startSignIn', { client, callbackOrigin: url.origin, loginSource: 'web' })
    const waiting = await wait(state => state.attempt?.phase === 'waiting-browser')
    const authorization = new URL(waiting.attempt.authorizeUrl)
    assert.equal(authorization.hostname, '127.0.0.1')
    const page = await fetch(authorization)
    const request = /name="request" value="([^"]+)"/.exec(await page.text())?.[1]
    assert.ok(request)
    const approved = await fetch(new URL('/sso/simulator/login', authorization), { method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ request, account: 'developer', mode: 'success' }) })
    assert.equal(approved.status, 302)
    const callback = await fetch(approved.headers.get('location'), { redirect: 'manual' })
    assert.equal(callback.status, 204)
    const signedIn = await wait(state => state.attempt?.phase === 'succeeded')
    assert.equal(signedIn.authenticationMethod, 'iam')
    assert.equal(signedIn.status, 'credential-stored')
    const profile = await rpc('account/getProfile', { client })
    assert.equal(profile.value.contact, 'developer@example.test')
    const models = await rpc('session/modelCatalog')
    assert.ok(models.groups.some(group => group.id === 'company-gateway'
      && group.models.some(model => model.id === 'haier-simulator')))
    await rpc('account/signOut', { client })
    assert.equal((await rpc('account/getState')).status, 'signed-out')
    const cleared = await rpc('session/modelCatalog')
    assert.ok(!cleared.groups.find(group => group.id === 'company-gateway')?.models.length)
    await rpc('account/startSignIn', { client, callbackOrigin: url.origin, loginSource: 'web' })
    const pending = await wait(state => state.attempt?.phase === 'waiting-browser')
    await rpc('account/cancelSignIn', { attemptId: pending.attempt.id })
    assert.equal((await rpc('account/getState')).status, 'signed-out')
    console.log('PASS: real Web Host IAM login, company profile, model discovery, sign-out cleanup and cancellation')
  } finally { await rpc('account/signOut', { client }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await verifyWeb(process.argv[2]) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
