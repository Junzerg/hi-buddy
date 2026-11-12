/** IAM model permissions initialize the shipped provider and label its image-capable models. */
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { DeepSeekAccount } from '@deepseek-ai/dsh-deepseek-account'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

let root: string
let endpoint: Server
let scaffold: WebScaffold
let browser: Browser
let page: Page
let discoveryRequests = 0

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-company-models-'))
  endpoint = createServer((req, res) => {
    if (req.url !== '/company-login/exchange' || req.method !== 'POST') {
      discoveryRequests++
      res.writeHead(404).end()
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ apiKey: 'fixture-key', account: 'employee', email: 'employee@example.test', models: [
      { modelName: 'volces-deepseek-v4-flash', contextLength: 128000, isMultimodal: true },
      { modelName: 'text-model', contextLength: null, isMultimodal: false },
    ] }))
  })
  await new Promise<void>(resolve => endpoint.listen(0, '127.0.0.1', resolve))
  const address = endpoint.address()
  if (!address || typeof address === 'string') throw new Error('Missing exchange listener')
  const origin = `http://127.0.0.1:${String(address.port)}`
  const overlay = join(root, 'company-models.yml')
  await writeFile(overlay, `- id: deepseek-account
  config:
    companyLogin: true
    platformOrigin: https://iam-stg.haierxj.com
    inferenceOrigin: ${origin}
    companyLoginEndpoint: ${origin}/company-login/exchange
- id: llm-pi-ai
  config:
    providers:
      company-gateway:
        displayName: HaierCash
        apiKeyEnv: COMPANY_GATEWAY_API_KEY
        accountRequired: true
        api: anthropic-messages
        baseURL: ${origin}
        models: []
- id: ui-settings-account
  config:
    step: done
    completion: completed
`)
  scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
  const account = scaffold.ctx.get('deepseekAccount') as DeepSeekAccount
  const lifetime = new AbortController()
  const phase = async (expected: string) => {
    for await (const view of account.watch(lifetime.signal)) {
      if (view.attempt?.phase === 'failed') throw new Error(`Company login failed: ${view.attempt.errorCode}`)
      if (view.attempt?.phase === expected) return view
    }
    throw new Error(`Missing login phase ${expected}`)
  }
  try {
    await account.startSignIn({ version: 'test', locale: 'zh', timezoneOffsetSeconds: 0 }, new URL(scaffold.authenticatedUrl).origin, 'web')
    const waiting = await phase('waiting-browser')
    const authorize = new URL(waiting.attempt!.authorizeUrl!)
    const callback = new URL(authorize.searchParams.get('redirect_uri')!)
    callback.search = new URLSearchParams({ code: 'fixture-code', state: authorize.searchParams.get('state')! }).toString()
    expect((await fetch(callback, { redirect: 'manual' })).status).toBe(204)
    await phase('succeeded')
  } finally {
    lifetime.abort()
  }
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: ZH_BROWSER_LOCALE })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
})

afterAll(async () => {
  try { await browser?.close() }
  finally {
    try { await scaffold?.close() }
    finally {
      if (endpoint) await new Promise<void>((resolve, reject) => {
        endpoint.close((error) => { if (error) reject(error); else resolve() })
        endpoint.closeAllConnections()
      })
      if (root) await rm(root, { recursive: true, force: true })
    }
  }
})

it('saves IAM model capabilities without model discovery and renders the multimodal label in both themes', async () => {
  expect(discoveryRequests).toBe(0)
  expect(await scaffold.ctx.llm.listModels('company-gateway')).toMatchObject([
    { id: 'volces-deepseek-v4-flash', inputModalities: ['text', 'image'] },
    { id: 'text-model', inputModalities: ['text'] },
  ])
  const settings = scaffold.ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === 'llm-pi-ai')
  expect(settings?.value).toMatchObject({ providers: { 'company-gateway': { models: [
    { id: 'volces-deepseek-v4-flash', contextWindow: 128000, input: ['text', 'image'] },
    { id: 'text-model', input: ['text'] },
  ] } } })
  const trigger = page.getByRole('button', { name: /^选择模型/ })
  await trigger.getByText('多模态', { exact: true }).waitFor()
  await trigger.click()
  const vision = page.getByRole('menuitemradio', { name: 'volces-deepseek-v4-flash 多模态', exact: true })
  await vision.waitFor()
  expect(await page.getByRole('menuitemradio', { name: 'text-model', exact: true }).getByText('多模态').count()).toBe(0)
  await expect(`${await page.getByRole('menu', { name: '模型', exact: true }).innerText()}\n`)
    .toMatchFileSnapshot('./expected/company-models/menu.txt')
  await saveFailureShot(page, 'company-models-light-preview')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(true)
  await saveFailureShot(page, 'company-models-dark-preview')
  await page.setViewportSize({ width: 390, height: 844 })
  const bounds = await vision.getByText('多模态').boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await page.keyboard.press('Escape')
  expect(await page.getByRole('menu', { name: '模型', exact: true }).count()).toBe(0)
  expect(discoveryRequests).toBe(0)
})
