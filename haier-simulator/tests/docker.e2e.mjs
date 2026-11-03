/** Real containers and the shipping exchange bundle; every run owns an independent Compose namespace and ports. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepare, compose, directory } from '../compose.mjs'
import { callback, authorize } from './protocol.mjs'

const json = value => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
test('Docker IAM and gateway work with the unmodified company-login service', { timeout: 120_000 }, async t => {
  const env = { ...process.env, COMPOSE_PROJECT_NAME: `haier-simulator-test-${randomBytes(5).toString('hex')}`,
    HAIER_SIMULATOR_PORT: '0', HAIER_EXCHANGE_PORT: '0' }
  const root = mkdtempSync(join(tmpdir(), 'haier-simulator-docker-'))
  const options = { env, capture: true, projectDirectory: root }
  let started = false
  t.after(async () => {
    try { if (started) await compose(['down', '--remove-orphans'], options) }
    finally { rmSync(root, { recursive: true, force: true }) }
  })
  for (const name of ['Dockerfile', '.dockerignore', 'compose.yaml', 'services.mjs', 'exchange.mjs']) {
    cpSync(join(directory, name), join(root, name))
  }
  await prepare({ contextDirectory: root })
  started = true
  await compose(['up', '--build', '-d', '--wait', '--wait-timeout', '60'], options)
  const address = async (service, port) => `http://${(await compose(['port', service, String(port)], options)).trim()}`
  const origin = await address('haier-services', 8080)
  const exchange = await address('company-login', 18766)
  const code = await authorize(origin)
  const response = await fetch(`${exchange}/company-login/exchange`, json({ code, redirectUri: callback }))
  assert.equal(response.status, 200)
  const identity = await response.json()
  assert.equal(identity.account, 'developer')
  assert.equal(identity.name, '开发用户')
  assert.ok(identity.apiKey.startsWith('sk-haier-simulator-'))
  assert.equal(identity.access_token, undefined)
  assert.equal((await fetch(`${exchange}/company-login/exchange`, json({ code, redirectUri: callback }))).status, 502)
  const headers = { authorization: `Bearer ${identity.apiKey}` }
  const models = await fetch(`${origin}/v1/models`, { headers })
  assert.equal((await models.json()).data[0].id, 'haier-simulator')
  const reply = await fetch(`${origin}/v1/chat/completions`, {
    ...json({ model: 'haier-simulator', stream: true, messages: [{ role: 'user', content: 'Docker 验证' }] }),
    headers: { ...headers, 'content-type': 'application/json' },
  })
  assert.match(await reply.text(), /Docker 验证/)
  const brokenCode = await authorize(origin, 'key-error')
  assert.equal((await fetch(`${exchange}/company-login/exchange`, json({ code: brokenCode, redirectUri: callback }))).status, 502)
  await fetch(`${origin}/__simulator/reset`, { method: 'POST' })
  assert.equal((await fetch(`${origin}/v1/models`, { headers })).status, 401)
})
