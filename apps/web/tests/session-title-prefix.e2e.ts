/** Title decorations coexist with the leading cell and collapse when their entries render null. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/plugins/fixture-title-prefix', import.meta.url))
const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const TITLE = 'A long session title with two independent inline decorations'

it('preserves row height, title space, and independent leading decorations across prefix changes', async () => {
  const scaffold = await launchWebScaffold({ extraInstallAnchors: [join(FIXTURE, 'package.json')] })
  onTestFinished(() => scaffold.close())
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
  const sessionId = await seedSession(scaffold, await readFile(SEED, 'utf8'), 'prefix-session')
  await workspace.attachSession(sessionId)
  await scaffold.ctx.sessionController.rename({ sessionId, title: TITLE })
  const entryId = await scaffold.ctx.loader.create({ name: '@fixture/title-prefix' })
  const browser = await chromium.launch()
  try {
    const page = await newEnglishPage(browser)
    const console = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const row = page.getByRole('treeitem').filter({ has: page.getByText(TITLE, { exact: true }) })
    const title = row.getByText(TITLE, { exact: true })
    const prefix = row.locator('[data-slot="sidebar.session.title.prefix"]')
    const marks = prefix.locator('[data-fixture-prefix]')
    const toggle = (visible: boolean) => page.evaluate((value) => {
      window.dispatchEvent(new CustomEvent('fixture-title-prefix', { detail: value }))
    }, visible)
    await row.waitFor()
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 })
      if (!await row.isVisible()) await page.getByRole('button', { name: 'Expand left sidebar', exact: true }).click()
      await row.locator('[data-fixture-leading]').waitFor()
      const before = (await title.boundingBox())!
      const height = (await row.boundingBox())!.height
      expect(await prefix.evaluate(element => element.parentElement!.getBoundingClientRect().width)).toBe(0)
      await toggle(true)
      await expect.poll(() => marks.count()).toBe(2)
      expect(await marks.evaluateAll(elements => elements.map(element => element.getAttribute('data-session-id'))))
        .toEqual([sessionId, sessionId])
      const after = (await title.boundingBox())!
      const leading = (await row.locator('[data-fixture-leading]').boundingBox())!
      const first = (await marks.first().boundingBox())!
      expect(first.x).toBeGreaterThanOrEqual(leading.x + leading.width)
      expect(after.x).toBeGreaterThan(first.x + first.width)
      expect(after.width).toBeLessThan(before.width)
      expect(after.width).toBeGreaterThan(0)
      expect((await row.boundingBox())!.height).toBe(height)
      expect(await title.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
      await toggle(false)
      await expect.poll(() => marks.count()).toBe(0)
      expect((await title.boundingBox())!.x).toBeCloseTo(before.x)
      expect((await title.boundingBox())!.width).toBeCloseTo(before.width)
    }
    await toggle(true)
    await expect.poll(() => marks.count()).toBe(2)
    scaffold.ctx.loader.remove(entryId)
    await expect.poll(() => marks.count()).toBe(0)
    expect(await prefix.evaluate(element => element.parentElement!.getBoundingClientRect().width)).toBe(0)
    expect(console.pageErrors).toEqual([])
  } finally {
    await browser.close()
  }
})
