/** The blank-home composer has no context or token statistics before a model turn. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const NO_CHAT = fileURLToPath(new URL('./fixtures/context-meter-no-chat.patch.yml', import.meta.url))

describe.skipIf(webSnapshotMode() === 'record')('web e2e: context details placement', () => {
  it.each([true, false])('keeps blank-home statistics empty (Chat statistics: %s)', async (withStats) => {
    const scaffold = await launchWebScaffold({
      ...withStats ? {} : { extraOverlayPath: NO_CHAT },
    })
    try {
      const browser = await chromium.launch()
      try {
        const page = await newEnglishPage(browser)
        const tripwire = watchConsole(page)
        await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
        await connectFreshWorkspace(page, scaffold.workspaceCwd)
        await page.locator('[data-composer-card]').waitFor()
        expect(await page.getByRole('button', { name: /% of context used$/ }).count()).toBe(0)
        expect(await page.getByRole('button', { name: /tok · Cache hit/ }).count()).toBe(0)
        const dock = page.locator('[data-composer-dock]')
        await dock.waitFor({ state: 'attached' })
        expect(await dock.locator(':scope > *').count()).toBe(0)
        expect(tripwire.pageErrors).toEqual([])
        expect(tripwire.warnings).toEqual([])
      } finally {
        await browser.close()
      }
    } finally {
      await scaffold.close()
    }
  })
})
