/** New tasks hide mode choices and create Standard sessions even with another Host default. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { saveFailureShot } from './support.ts'

let scaffold: WebScaffold
let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await chromium.launch()
  scaffold = await launchWebScaffold({ developerTools: true, agentPresets: { default: 'minimal' } })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
})

afterAll(async () => {
  await browser?.close()
  await scaffold?.close()
})

it('keeps mode choices hidden and creates a Standard task without changing the Host default', async () => {
  onTestFailed(() => saveFailureShot(page, 'new-task-standard'))
  const modes = page.locator('[role="radiogroup"]')
  await modes.waitFor({ state: 'attached', timeout: 30_000 })
  expect(await page.getByRole('radiogroup').count()).toBe(0)
  expect(await modes.locator('[role="radio"]').count()).toBe(4)
  expect(await modes.evaluate(element => element.getBoundingClientRect().height)).toBe(0)
  expect(scaffold.ctx.agentPresets.defaultId).toBe('minimal')

  const workspace = join(scaffold.workspaceCwd, 'workspace')
  await mkdir(workspace, { recursive: true })
  await page.getByRole('button', { name: 'Add workspace', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Select Workspace Directory' })
  await picker.getByRole('button', { name: 'Edit path' }).click()
  const path = picker.getByRole('textbox', { name: 'Edit path' })
  await path.fill(workspace)
  await path.press('Enter')
  await picker.getByRole('button', { name: 'Open', exact: true }).click()
  await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 15_000 })

  await expect.poll(async () => {
    const response = await scaffold.hostFetch('/api/session/list', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'standard-task', method: 'session/list', payload: { args: { _request: {} } } }),
    })
    const body = await response.json() as {
      result: { value?: { items: { projections?: { values: { agentPreset?: string | null } } }[] } }
    }
    return body.result.value?.items.map(item => item.projections?.values.agentPreset)
  }).toEqual(['standard'])
  expect(await page.getByRole('radio').count()).toBe(0)
  expect(scaffold.ctx.agentPresets.defaultId).toBe('minimal')
  await saveFailureShot(page, 'new-task-standard-preview')
})
