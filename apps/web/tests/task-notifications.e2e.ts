/** Task completion notifications survive reload and a browser restart using the same device profile. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, expect, it, onTestFailed } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { launchWebScaffold, seedSession, type WebScaffold } from './scaffold.ts'
import { saveFailureShot } from './support.ts'

let scaffold: WebScaffold
let context: BrowserContext
let page: Page
let profile: string
let browserEnvironment: NodeJS.ProcessEnv
const ids: SessionId[] = []

async function openBrowser(): Promise<void> {
  context = await chromium.launchPersistentContext(profile, {
    headless: true, viewport: { width: 1440, height: 900 }, locale: 'en-US', env: browserEnvironment,
  })
  page = await context.newPage()
}

function finish(id: SessionId): void {
  // The live Agent status is the nondeterministic input; all Host transport and UI owners remain real.
  scaffold.ctx.emit('api-session/status', id, true)
  scaffold.ctx.emit('api-session/status', id, false)
}

beforeAll(async () => {
  browserEnvironment = { ...process.env }
  profile = await mkdtemp(join(tmpdir(), 'dsh-notification-profile-'))
  await openBrowser()
  scaffold = await launchWebScaffold({ developerTools: true })
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
  const fixture = await readFile(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url), 'utf8')
  for (const [index, title] of ['Current task', 'Quarterly report', 'Document summary'].entries()) {
    const id = await seedSession(scaffold, fixture, `task-notifications-${index}`)
    ids.push(id)
    await workspace.attachSession(id)
    await (scaffold.ctx.get('sessionController') as SessionController).rename({ sessionId: id, title })
  }
  await page.addInitScript((sessionId) => {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
  }, ids[0])
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Notifications', exact: true }).waitFor({ timeout: 30_000 })
})

afterAll(async () => {
  await context?.close()
  await scaffold?.close()
  if (profile !== undefined) await rm(profile, { recursive: true, force: true })
})

it('starts without historical notifications and opens an empty list', async () => {
  onTestFailed(() => saveFailureShot(page, 'task-notifications-empty'))
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await page.getByText('No unread notifications', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  expect(await page.getByRole('menu').count()).toBe(0)
})

it('lists unread completions without acknowledging them and retains them on reload', async () => {
  onTestFailed(() => saveFailureShot(page, 'task-notifications-unread'))
  finish(ids[1]!)
  finish(ids[2]!)
  const bell = page.getByRole('button', { name: 'Notifications, 2 unread', exact: true })
  await bell.waitFor()
  await bell.click()
  await page.getByRole('menuitem', { name: /Quarterly report/ }).waitFor()
  await page.getByRole('menuitem', { name: /Document summary/ }).waitFor()
  await saveFailureShot(page, 'task-notifications-preview')
  const bounds = await page.getByRole('menu').boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1440)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(true)
  await saveFailureShot(page, 'task-notifications-dark-preview')
  await page.setViewportSize({ width: 390, height: 900 })
  const narrow = await page.getByRole('menu').boundingBox()
  expect(narrow!.x).toBeGreaterThanOrEqual(0)
  expect(narrow!.x + narrow!.width).toBeLessThanOrEqual(390)
  await page.getByRole('tab', { name: 'Chat', exact: true }).click()
  expect(await page.getByRole('menu').count()).toBe(0)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload({ waitUntil: 'load' })
  await page.getByRole('button', { name: 'Notifications, 2 unread', exact: true }).waitFor()
})

it('opens a task, preserves the remaining unread task after restart, and remembers both reads', async () => {
  onTestFailed(() => saveFailureShot(page, 'task-notifications-read'))
  await page.getByRole('button', { name: 'Notifications, 2 unread', exact: true }).click()
  await page.getByRole('menuitem', { name: /Quarterly report/ }).click()
  await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).waitFor()
  await context.close()
  await openBrowser()
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).click()
  expect(await page.getByRole('menuitem', { name: /Quarterly report/ }).count()).toBe(0)
  await page.getByRole('menuitem', { name: /Document summary/ }).click()
  await page.getByRole('button', { name: 'Notifications', exact: true }).waitFor()
  await page.reload({ waitUntil: 'load' })
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await page.getByText('No unread notifications', { exact: true }).waitFor()
  await page.keyboard.press('Escape')

  finish(ids[1]!)
  await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).click()
  await page.getByRole('menuitem', { name: /Quarterly report/ }).waitFor()
})
