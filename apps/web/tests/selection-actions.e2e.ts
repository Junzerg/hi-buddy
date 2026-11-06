/** Real Loader and browser coverage for additive, Session-bound selection actions. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/plugins/fixture-selection-action', import.meta.url))
const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))

it('preserves Quote beside an extension, carries the source Session, and removes unloaded actions', async () => {
  const scaffold = await launchWebScaffold({ extraInstallAnchors: [join(FIXTURE, 'package.json')] })
  onTestFinished(() => scaffold.close())
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
  const sessionId = await seedSession(scaffold, await readFile(SEED, 'utf8'), 'selection-action-session')
  await workspace.attachSession(sessionId)
  await scaffold.ctx.sessionController.rename({ sessionId, title: 'Selection action session' })
  const entryId = await scaffold.ctx.loader.create({ name: '@fixture/selection-action' })
  const browser = await chromium.launch()
  try {
    const page = await newEnglishPage(browser)
    const console = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const row = page.getByRole('treeitem').filter({ has: page.getByText('Selection action session', { exact: true }) })
    await row.click()
    const source = page.locator('[data-message-bubble][data-text-interaction-source]').first()
    await source.waitFor()
    const text = await source.innerText()
    const select = async () => {
      await source.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      })
    }
    const quote = page.getByRole('button', { name: 'Quote text', exact: true })
    const capture = page.getByRole('button', { name: 'Capture selection', exact: true })
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await source.scrollIntoViewIfNeeded()
      await select()
      await capture.waitFor()
      expect(await quote.isVisible()).toBe(true)
      const bounds = await capture.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      await capture.click()
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.selectionCapture))
        .toBe(JSON.stringify({ sessionId, text }))
      await expect.poll(() => capture.count()).toBe(0)
    }
    scaffold.ctx.loader.remove(entryId)
    await select()
    await quote.waitFor()
    await expect.poll(() => capture.count()).toBe(0)
    expect(console.pageErrors).toEqual([])
  } finally {
    await browser.close()
  }
})
