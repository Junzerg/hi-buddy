/** Footer account actions stay available; View overflow appears only while Views are folded. */
import { readFile } from 'node:fs/promises'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, type WebScaffold } from './scaffold.ts'
import { saveFailureShot } from './support.ts'

let scaffold: WebScaffold
let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await chromium.launch()
  scaffold = await launchWebScaffold({ developerTools: true })
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
  const id = await seedSession(scaffold, await readFile(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url), 'utf8'), 'session-view-menu')
  await workspace.attachSession(id)
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
  await page.addInitScript((sessionId) => {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
  }, id)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('tab', { name: 'Trajectory', exact: true }).waitFor({ timeout: 30_000 })
})

afterAll(async () => {
  await browser?.close()
  await scaffold?.close()
})

it('keeps login, feedback and Settings available in the sidebar footer', async () => {
  onTestFailed(() => saveFailureShot(page, 'session-footer-actions'))
  await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  for (const name of ['Settings', 'Feedback', 'Sign in']) {
    await page.getByRole('menuitem', { name, exact: true }).waitFor()
  }
  await saveFailureShot(page, 'session-footer-menu-preview')
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.waitFor()
  await settings.getByRole('button', { name: 'Close', exact: true }).last().click()
})

it('hides empty More, preserves folded View navigation, and hides More again when widened', async () => {
  onTestFailed(() => saveFailureShot(page, 'session-view-menu'))
  expect(await page.getByRole('tab', { name: 'Chat', exact: true }).isVisible()).toBe(true)
  expect(await page.getByRole('tab', { name: 'Trajectory', exact: true }).isVisible()).toBe(true)
  expect(await page.getByRole('button', { name: /^More conversation views/ }).count()).toBe(0)
  await saveFailureShot(page, 'session-view-tabs-preview')

  await page.setViewportSize({ width: 390, height: 900 })
  const more = page.getByRole('button', { name: /^More conversation views/ })
  await more.waitFor()
  await more.click()
  await page.getByRole('menuitem', { name: 'Trajectory', exact: true }).click()
  await expect.poll(() => more.getAttribute('aria-label')).toBe('More conversation views · Trajectory')
  await more.focus()

  await page.setViewportSize({ width: 1440, height: 900 })
  const trajectory = page.getByRole('tab', { name: 'Trajectory', exact: true })
  await trajectory.waitFor()
  expect(await trajectory.getAttribute('aria-selected')).toBe('true')
  expect(await more.count()).toBe(0)
  expect(await trajectory.evaluate(element => element === document.activeElement)).toBe(true)
})
