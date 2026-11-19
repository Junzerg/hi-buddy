// Task 8 profile specs: the --hibuddy development template, its
// replace-not-merge account row, and the hibuddy-server health probe.
// company-mode template and merge semantics are pinned byte-identical here
// and in services.test.mjs; anything this file changes is hi-buddy-only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { simulatorPatch, prepareWeb, configureHaierDevelopment } from '../profile.ts'

const companyTemplate = `- id: deepseek-account
  config:
    companyLogin: true
    companyLoginEndpoint: http://127.0.0.1:18081/company-login/exchange
    platformOrigin: http://127.0.0.1:18080
    inferenceOrigin: http://127.0.0.1:18080
    allowLoopbackHttp: true
    requestTimeoutMs: 10000
- id: llm-pi-ai
  config:
    providers:
      company-gateway:
        displayName: 海尔服务模拟器
        apiKeyEnv: COMPANY_GATEWAY_API_KEY
        accountRequired: true
        api: openai-completions
        baseURL: http://127.0.0.1:18080/v1
        models: []
- id: agent-default-model
  config:
    provider: company-gateway
    model: ''
- id: ui-settings-account
  config:
    feedbackDestination: internal-team
    requireIamLogin: true
`

test('simulatorPatch("company") stays byte-identical to the pre-hibuddy template', () => {
  assert.equal(simulatorPatch('company'), companyTemplate)
})

test('simulatorPatch("hi-buddy") swaps the login row and drops the company gateway', () => {
  const rows = load(simulatorPatch('hi-buddy'))
  const ids = rows.map(row => row.id)
  assert.ok(!ids.includes('llm-pi-ai'), '不写 company-gateway（无 llm-pi-ai 行）')
  assert.deepEqual(rows.find(row => row.id === 'deepseek-account').config, {
    hiBuddyLogin: true, allowLoopbackHttp: true, requestTimeoutMs: 10000,
  })
  // model is required by the plugin schema; '' = no default selected yet
  // (an absent key fails validation and leaves session-controller pending).
  assert.deepEqual(rows.find(row => row.id === 'agent-default-model').config, { provider: 'deepseek', model: '' })
})

test('prepareWeb hi-buddy mode replaces the account row instead of merging it', t => {
  const root = mkdtempSync(join(tmpdir(), 'haier-simulator-hibuddy-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  prepareWeb({ stateDirectory: root })
  prepareWeb({ stateDirectory: root, mode: 'hi-buddy' })
  const rows = load(readFileSync(join(root, 'home/profiles/web/cordis.patch.yml'), 'utf8'))
  const account = rows.find(row => row.id === 'deepseek-account')
  assert.deepEqual(account.config, { hiBuddyLogin: true, allowLoopbackHttp: true, requestTimeoutMs: 10000 })
  assert.equal(account.config.companyLogin, undefined, '旧 company 键消失，非合并')
  assert.equal(account.config.companyLoginEndpoint, undefined)
  assert.equal(account.config.platformOrigin, undefined)
})

test('prepareWeb company mode replaces the account row instead of merging it', t => {
  const root = mkdtempSync(join(tmpdir(), 'haier-simulator-company-switchback-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  prepareWeb({ stateDirectory: root, mode: 'hi-buddy' })
  prepareWeb({ stateDirectory: root })
  const rows = load(readFileSync(join(root, 'home/profiles/web/cordis.patch.yml'), 'utf8'))
  const account = rows.find(row => row.id === 'deepseek-account')
  // A leftover hiBuddyLogin would trip the account service's mutual-exclusion guard.
  assert.equal(account.config.hiBuddyLogin, undefined, '旧 hi-buddy 键消失，非合并')
  assert.equal(account.config.companyLogin, true)
  assert.equal(account.config.companyLoginEndpoint, 'http://127.0.0.1:18081/company-login/exchange')
  assert.deepEqual(rows.find(row => row.id === 'agent-default-model').config, { provider: 'company-gateway', model: '' })
})

test('prepareWeb hi-buddy mode replaces the default-model row: company-gateway cannot survive the switch', t => {
  const root = mkdtempSync(join(tmpdir(), 'haier-simulator-hibuddy-model-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  prepareWeb({ stateDirectory: root })
  prepareWeb({ stateDirectory: root, mode: 'hi-buddy' })
  const rows = load(readFileSync(join(root, 'home/profiles/web/cordis.patch.yml'), 'utf8'))
  // The simulator is not running in hi-buddy mode; routing must leave company-gateway.
  // model stays '' — the required key must survive the replace, not just provider.
  assert.deepEqual(rows.find(row => row.id === 'agent-default-model').config, { provider: 'deepseek', model: '' })
})

test('configureHaierDevelopment hi-buddy accepts an auth challenge and diagnoses a failed probe', async t => {
  const root = mkdtempSync(join(tmpdir(), 'haier-simulator-hibuddy-probe-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const unavailable = createServer(request => request.socket.destroy())
  t.after(() => new Promise(resolve => unavailable.close(resolve)))
  await new Promise(resolve => unavailable.listen(0, '127.0.0.1', resolve))
  await assert.rejects(
    configureHaierDevelopment({
      mode: 'hi-buddy', stateDirectory: root, hibuddyEndpoint: `http://127.0.0.1:${unavailable.address().port}`,
    }),
    /hibuddy-server is not reachable/,
  )

  // /v1/connectors is session-authed (401 anonymous), so an error status still
  // proves hibuddy-server is up and must not block setup.
  const authed = createServer((_request, response) => { response.writeHead(401).end() })
  t.after(() => new Promise(resolve => authed.close(resolve)))
  await new Promise(resolve => authed.listen(0, '127.0.0.1', resolve))
  const configured = await configureHaierDevelopment({
    mode: 'hi-buddy', stateDirectory: root,
    hibuddyEndpoint: `http://127.0.0.1:${authed.address().port}`,
  })
  assert.deepEqual(configured.appArgs, ['--host', '127.0.0.1', '--port', '3080'])
})

test('configureHaierDevelopment hi-buddy succeeds against a live connector list and wires the profile', async t => {
  const root = mkdtempSync(join(tmpdir(), 'haier-simulator-hibuddy-live-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const probed = []
  const server = createServer((request, response) => {
    probed.push(request.url)
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items: [] }))
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const configured = await configureHaierDevelopment({
    mode: 'hi-buddy', stateDirectory: root,
    hibuddyEndpoint: `http://127.0.0.1:${server.address().port}`,
  })
  assert.deepEqual(probed, ['/v1/connectors'])
  assert.deepEqual(configured.appArgs, ['--host', '127.0.0.1', '--port', '3080'])
  assert.equal(configured.env.DSH_HOME, join(root, 'home'))
  assert.match(readFileSync(join(root, 'home/profiles/web/cordis.patch.yml'), 'utf8'), /hiBuddyLogin: true/)
  // The launcher's probed endpoint must reach both kits: neither bundled patch
  // pins a server address, so these profile rows carry the probed HIBUDDY_ENDPOINT.
  const rows = load(readFileSync(join(root, 'home/profiles/web/cordis.patch.yml'), 'utf8'))
  const probedEndpoint = `http://127.0.0.1:${server.address().port}`
  assert.equal(rows.find(row => row.id === 'hi-buddy-account-platform').config.endpoint, probedEndpoint)
  assert.equal(rows.find(row => row.id === 'hi-buddy-connector-kit').config.apiBaseUrl, probedEndpoint)
})

test('prepareWeb hi-buddy appends kit rows to a pre-injection patch and updates them on endpoint change', t => {
  const root = mkdtempSync(join(tmpdir(), 'haier-simulator-hibuddy-endpoint-update-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  // Simulate a patch written before the launcher injected kit rows: the merge
  // loop must append the missing kit rows, then update their addresses in place
  // when HIBUDDY_ENDPOINT changes between runs.
  mkdirSync(join(root, 'home/profiles/web'), { recursive: true })
  writeFileSync(join(root, 'home/profiles/web/cordis.patch.yml'), '- id: deepseek-account\n  config:\n    hiBuddyLogin: true\n')
  prepareWeb({ stateDirectory: root, mode: 'hi-buddy', hibuddyEndpoint: 'https://first.example.com' })
  prepareWeb({ stateDirectory: root, mode: 'hi-buddy', hibuddyEndpoint: 'https://second.example.com' })
  const rows = load(readFileSync(join(root, 'home/profiles/web/cordis.patch.yml'), 'utf8'))
  assert.equal(rows.find(row => row.id === 'deepseek-account').config.hiBuddyLogin, true, '既有行保留')
  assert.equal(rows.find(row => row.id === 'hi-buddy-account-platform').config.endpoint, 'https://second.example.com')
  assert.equal(rows.find(row => row.id === 'hi-buddy-connector-kit').config.apiBaseUrl, 'https://second.example.com')
})
