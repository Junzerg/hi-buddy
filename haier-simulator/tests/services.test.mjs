import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHaierSimulator, CLIENT_SECRET, GATEWAY_SECRET, MODEL } from '../services.mjs'
import { simulatorPatch, prepareWeb, configureHaierDevelopment } from '../profile.ts'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load, dump } from 'js-yaml'

import { callback, authorize, form } from './protocol.mjs'
async function fixture(t, options) {
  const server = createHaierSimulator(options)
  t.after(() => new Promise((accept, reject) => {
    server.close(error => error ? reject(error) : accept())
    server.closeAllConnections()
  }))
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept) })
  return `http://127.0.0.1:${server.address().port}`
}
const json = value => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
const tokenRequest = code => ({ grant_type: 'authorization_code', client_id: 'APP176', client_secret: CLIENT_SECRET,
  code, redirect_uri: callback })
async function login(origin, mode = 'success', account = 'developer') {
  const code = await authorize(origin, mode, account)
  const tokenResponse = await fetch(`${origin}/sso/oauth2/token`, form(tokenRequest(code)))
  if (!tokenResponse.ok) return { failed: 'token', response: tokenResponse }
  const { access_token } = await tokenResponse.json()
  const profile = await fetch(`${origin}/sso/oauth2/userInfo`, form({ access_token }))
  if (!profile.ok) return { failed: 'userinfo', response: profile }
  const user = await profile.json()
  const keyResponse = await fetch(`${origin}/ploto-llm-admin-app/api/internal/apiKey/getOrCreate`, {
    ...json({ account: user.email.split('@')[0], system: 'lingxi-office', authSecret: GATEWAY_SECRET }),
    headers: { 'content-type': 'application/json', 'X-Ploto-Direct-Target': 'ploto-llm-admin-app' },
  })
  if (!keyResponse.ok) return { failed: 'key', response: keyResponse }
  return { user, key: (await keyResponse.json()).data.apiKey }
}

test('runs the IAM, profile, personal-key and model HTTP contracts', async t => {
  const origin = await fixture(t)
  const { user, key } = await login(origin)
  assert.equal(user.email, 'developer@example.test')
  assert.equal(user.orgName, 'AI工程')
  const headers = { authorization: `Bearer ${key}` }
  const models = await fetch(`${origin}/v1/models`, { headers })
  assert.equal(models.status, 200)
  assert.equal((await models.json()).data[0].id, MODEL)
  const reply = await fetch(`${origin}/v1/chat/completions`, {
    ...json({ model: MODEL, messages: [{ role: 'user', content: '测试消息' }] }),
    headers: { ...headers, 'content-type': 'application/json' },
  })
  assert.match((await reply.json()).choices[0].message.content, /已收到：测试消息/)
  assert.equal((await login(origin)).key, key)
  assert.notEqual((await login(origin, 'success', 'reviewer')).key, key)
})

test('streams OpenAI-compatible deltas, finish reason, usage and DONE', async t => {
  const origin = await fixture(t)
  const { key } = await login(origin)
  const response = await fetch(`${origin}/v1/chat/completions`, {
    ...json({ model: MODEL, stream: true, messages: [{ role: 'user', content: [{ type: 'text', text: '流式消息' }] }] }),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  })
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  const events = (await response.text()).trim().split('\n\n').map(value => value.slice(6))
  assert.equal(events.pop(), '[DONE]')
  const chunks = events.map(value => JSON.parse(value))
  assert.match(chunks[1].choices[0].delta.content, /流式消息/)
  assert.equal(chunks[2].choices[0].finish_reason, 'stop')
  assert.equal(chunks[3].usage.total_tokens, 30)
})

test('binds one-use authorization codes to the client and callback', async t => {
  const origin = await fixture(t)
  const code = await authorize(origin)
  assert.equal((await fetch(`${origin}/sso/oauth2/token`, form({ ...tokenRequest(code), client_secret: 'wrong' }))).status, 401)
  assert.equal((await fetch(`${origin}/sso/oauth2/token`, form({ ...tokenRequest(code), redirect_uri: 'http://wrong/' }))).status, 400)
  assert.equal((await fetch(`${origin}/sso/oauth2/token`, form(tokenRequest(code)))).status, 200)
  assert.equal((await fetch(`${origin}/sso/oauth2/token`, form(tokenRequest(code)))).status, 400)
})

test('rejects unregistered callbacks and duplicate state fields', async t => {
  const origin = await fixture(t)
  for (const query of [
    { client_id: 'APP176', response_type: 'code', redirect_uri: 'http://untrusted.test/callback', state: 'x' },
    { client_id: 'wrong', response_type: 'code', redirect_uri: callback, state: 'x' },
  ]) assert.equal((await fetch(`${origin}/sso/oauth2/authorize?${new URLSearchParams(query)}`)).status, 400)
  assert.equal((await fetch(`${origin}/sso/oauth2/authorize?client_id=APP176&response_type=code&redirect_uri=${encodeURIComponent(callback)}&state=a&state=b`)).status, 400)
})

for (const [mode, failed] of [['denied', 'token'], ['expired-code', 'token'], ['token-error', 'token'],
  ['userinfo-error', 'userinfo'], ['key-error', 'key']]) {
  test(`simulates ${mode} at its real protocol boundary`, async t => {
    const outcome = await login(await fixture(t), mode)
    assert.equal(outcome.failed, failed)
    assert.equal(outcome.response.ok, false)
    await outcome.response.body?.cancel()
  })
}

test('models can fail after a successful identity exchange', async t => {
  const origin = await fixture(t)
  const { key } = await login(origin, 'model-error')
  assert.equal((await fetch(`${origin}/v1/models`, { headers: { authorization: `Bearer ${key}` } })).status, 503)
})

test('reset revokes keys and IAM tokens, with no state shared across instances', async t => {
  const origin = await fixture(t)
  const other = await fixture(t)
  const { key } = await login(origin)
  const options = { headers: { authorization: `Bearer ${key}` } }
  assert.equal((await fetch(`${other}/v1/models`, options)).status, 401)
  await fetch(`${origin}/__simulator/reset`, { method: 'POST' })
  assert.equal((await fetch(`${origin}/v1/models`, options)).status, 401)
  assert.notEqual((await login(origin)).key, key)
})

test('writes only an isolated development patch with loopback endpoints', t => {
  const root = mkdtempSync(join(tmpdir(), 'haier-simulator-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const result = prepareWeb({ stateDirectory: root, servicesPort: 18090, exchangePort: 18091 })
  const text = readFileSync(result.patch, 'utf8')
  assert.equal(text, simulatorPatch({ servicesPort: 18090, exchangePort: 18091 }))
  assert.ok(result.env.DSH_HOME.startsWith(root))
  assert.match(text, /companyLogin: true/)
  assert.match(text, /http:\/\/127\.0\.0\.1:18090\/v1/)
  assert.match(text, /http:\/\/127\.0\.0\.1:18091\/company-login\/exchange/)
  assert.doesNotMatch(text, /172\.28\.|haierxj\.com|ai-gateway\.haierxj/)
})

test('expires authorization codes and IAM tokens using an instance-owned clock', async t => {
  let current = 1000
  const origin = await fixture(t, { now: () => current })
  const code = await authorize(origin)
  current += 600_001
  assert.equal((await fetch(`${origin}/sso/oauth2/token`, form(tokenRequest(code)))).status, 400)
  const fresh = await authorize(origin)
  const response = await fetch(`${origin}/sso/oauth2/token`, form(tokenRequest(fresh)))
  const { access_token } = await response.json()
  current += 600_001
  assert.equal((await fetch(`${origin}/sso/oauth2/userInfo`, form({ access_token }))).status, 401)
})

test('refreshes local endpoints without replacing saved models or the default selection', t => {
  const root = mkdtempSync(join(tmpdir(), 'haier-simulator-profile-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { patch } = prepareWeb({ stateDirectory: root })
  const rows = load(readFileSync(patch, 'utf8'))
  rows.find(row => row.id === 'llm-pi-ai').config.providers['company-gateway'].models = [{ id: MODEL }]
  rows.find(row => row.id === 'agent-default-model').config.model = MODEL
  writeFileSync(patch, dump(rows))
  prepareWeb({ stateDirectory: root, servicesPort: 18100, exchangePort: 18101 })
  const updated = load(readFileSync(patch, 'utf8'))
  assert.deepEqual(updated.find(row => row.id === 'llm-pi-ai').config.providers['company-gateway'].models, [{ id: MODEL }])
  assert.equal(updated.find(row => row.id === 'llm-pi-ai').config.providers['company-gateway'].baseURL, 'http://127.0.0.1:18100/v1')
  assert.equal(updated.find(row => row.id === 'agent-default-model').config.model, MODEL)
})

test('rejects malformed JSON and unauthenticated model requests', async t => {
  const origin = await fixture(t)
  assert.equal((await fetch(`${origin}/v1/chat/completions`, json({ model: MODEL, messages: [] }))).status, 401)
  const keyEndpoint = `${origin}/ploto-llm-admin-app/api/internal/apiKey/getOrCreate`
  assert.equal((await fetch(keyEndpoint, json(null))).status, 400)
  assert.equal((await fetch(keyEndpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400)
  assert.equal((await fetch(keyEndpoint, json({ account: 'developer', system: 'lingxi-office', authSecret: 'wrong' }))).status, 403)
})

test('connects the standard Web entry to the simulator without mutating the parent environment', async t => {
  const root = mkdtempSync(join(tmpdir(), 'haier-simulator-entry-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const origin = await fixture(t)
  const environment = { DSH_HOME: '/existing/home', HAIER_SIMULATOR_PORT: new URL(origin).port, PATH: 'preserved' }
  const configured = await configureHaierDevelopment({ environment, stateDirectory: root, appArgs: ['--no-open'] })
  assert.equal(environment.DSH_HOME, '/existing/home')
  assert.equal(configured.env.DSH_HOME, join(root, 'home'))
  assert.equal(configured.env.PATH, 'preserved')
  assert.deepEqual(configured.appArgs, ['--host', '127.0.0.1', '--port', '3080', '--no-open'])
  assert.match(readFileSync(join(root, 'home/profiles/web/cordis.patch.yml'), 'utf8'), new RegExp(origin))
})

test('rejects conflicting callback addresses and invalid simulator ports before setup', async () => {
  for (const appArgs of [['--port', '9999'], ['--host=0.0.0.0'], ['--public-url', 'http://example.test']]) {
    await assert.rejects(configureHaierDevelopment({ appArgs }), /omit address overrides/)
  }
  await assert.rejects(configureHaierDevelopment({ environment: { HAIER_SIMULATOR_PORT: 'invalid' } }), /ports must be/)
})

test('allows the validated application callback after browser form submission', async t => {
  const origin = await fixture(t)
  const response = await fetch(`${origin}/sso/oauth2/authorize?${new URLSearchParams({
    client_id: 'APP176', response_type: 'code', redirect_uri: callback, state: 'browser-form-state',
  })}`)
  assert.equal(response.status, 200)
  const policy = response.headers.get('content-security-policy')
  const formActions = policy.split(';').map(value => value.trim()).find(value => value.startsWith('form-action '))
  assert.equal(formActions, `form-action 'self' ${new URL(callback).origin}`)
  assert.doesNotMatch(formActions, /\*/)
  await response.body.cancel()
  const consolePage = await fetch(origin)
  assert.match(consolePage.headers.get('content-security-policy'), /form-action 'self';/)
  await consolePage.body.cancel()
})
