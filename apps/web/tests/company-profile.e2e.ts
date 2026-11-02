/** Company identity rendered through the shipped Host, account transport and sidebar composition. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it, onTestFailed } from 'vitest'
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { DeepSeekAccount } from '@deepseek-ai/dsh-deepseek-account'
import { companyAccountProfile } from '../../../packages/credentials/deepseek-account-platform/src/company.ts'
import { launchWebScaffold, seedSession, type WebScaffold } from './scaffold.ts'
import { saveFailureShot } from './support.ts'

let root: string
let scaffold: WebScaffold
let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await chromium.launch()
  root = await mkdtemp(join(tmpdir(), 'dsh-company-profile-'))
  const overlay = join(root, 'company-profile.yml')
  await writeFile(overlay, `- id: deepseek-account
  config:
    companyLogin: true
    platformOrigin: https://iam-stg.haierxj.com
    companyLoginEndpoint: http://127.0.0.1:1/company-login/exchange
- id: ui-settings-account
  config:
    step: done
    completion: completed
`)
  scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
  // The external IAM result is a durable fixture; the account provider and all UI owners remain real.
  const companyProfile = companyAccountProfile({ apiKey: 'fixture-key', account: 'employee', email: 'employee@example.test',
    name: '张宁', orgName: 'AI工程', orgPathName: '/示例公司/金融科技中心/架构平台/' })
  const credentials = scaffold.ctx.get('credentials') as CredentialProvider
  await credentials.modifyRecord(credentialKey('deepseek-account-platform', 'default'), () => Promise.resolve({
    kind: 'grant', payload: { version: 1, token: 'fixture-key', issuer: 'https://iam-stg.haierxj.com', companyProfile },
  }))
  const account = scaffold.ctx.get('deepseekAccount') as DeepSeekAccount
  expect(await account.getProfile({ version: 'test', locale: 'en', timezoneOffsetSeconds: 0 }))
    .toEqual({ status: 'ready', value: companyProfile })
  const fixture = await readFile(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url), 'utf8')
  const sessionId = await seedSession(scaffold, fixture, 'company-profile')
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
  await workspace.attachSession(sessionId)
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US', colorScheme: 'light' })
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript((id) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id })) }, sessionId)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  try {
    await page.getByRole('button', { name: 'Account menu', exact: true }).filter({ hasText: '张' }).waitFor()
  } catch (error) {
    await saveFailureShot(page, 'company-profile-setup-failure')
    throw new Error(`Company profile did not render: ${errors.join('\n')}`, { cause: error })
  }
})

afterAll(async () => {
  await browser?.close()
  await scaffold?.close()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

it('shows the company name and department above the unchanged account actions in both themes and a narrow window', async () => {
  onTestFailed(() => saveFailureShot(page, 'company-profile-failure'))
  const trigger = page.getByRole('button', { name: 'Account menu', exact: true })
  await trigger.click()
  const menu = page.getByRole('menu')
  await menu.getByText('张宁', { exact: true }).waitFor()
  await menu.getByText('金融科技中心 / 架构平台 / AI工程', { exact: true }).waitFor()
  expect(await menu.getByRole('separator').count()).toBe(1)
  expect(await menu.getByRole('menuitem').allTextContents()).toEqual(['Settings', 'Feedback', 'Sign out'])
  await expect(`${await menu.textContent()}\n`).toMatchFileSnapshot('./expected/company-profile/menu.txt')
  await saveFailureShot(page, 'company-profile-preview')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(true)
  await saveFailureShot(page, 'company-profile-dark-preview')
  await page.setViewportSize({ width: 390, height: 900 })
  const bounds = await menu.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  const department = menu.getByText('金融科技中心 / 架构平台 / AI工程', { exact: true })
  expect(await department.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.keyboard.press('Escape')
  expect(await menu.count()).toBe(0)
  expect(await trigger.evaluate(element => element === document.activeElement)).toBe(true)
  await trigger.click()
  await page.mouse.click(380, 50)
  expect(await menu.count()).toBe(0)
  await page.setViewportSize({ width: 1440, height: 900 })
})

it('restores identity after reload and removes it after sign-out', async () => {
  onTestFailed(() => saveFailureShot(page, 'company-profile-signout-failure'))
  await page.reload({ waitUntil: 'load' })
  const trigger = page.getByRole('button', { name: 'Account menu', exact: true })
  await expect.poll(() => trigger.textContent()).toBe('张')
  await trigger.click()
  await page.getByRole('menu').getByText('张宁', { exact: true }).waitFor()
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect.poll(() => trigger.textContent()).toBe('')
  await page.reload({ waitUntil: 'load' })
  await trigger.click()
  await page.getByRole('menuitem', { name: 'Sign in', exact: true }).waitFor()
  expect(await page.getByRole('menu').getByText('张宁', { exact: true }).count()).toBe(0)
  expect(await page.getByRole('menu').getByRole('separator').count()).toBe(0)
})
