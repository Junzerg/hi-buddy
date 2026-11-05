/** Global navigation before the first Session, through the shipped Web composition. */
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'
import { initialShortcutConfig } from '@deepseek-ai/dsh-client-shortcuts/protocol'

let scaffold: WebScaffold
let browser: Browser

beforeAll(async () => {
  scaffold = await launchWebScaffold()
  browser = await chromium.launch()
})

afterAll(async () => {
  try { await browser?.close() }
  finally { await scaffold?.close() }
})

describe('navigation without a selected Session', () => {
  it.each(['web', 'win32', 'linux', 'darwin'] as const)('%s keeps the company blank-home header height and sidebar access', async (platform) => {
    const page = await newEnglishPage(browser)
    try {
      if (platform !== 'web') {
        await page.addInitScript(({ value, snapshot }) => {
          Object.assign(window, { dshDesktop: { protocolVersion: 1,
            keyboard: { subscribe: () => () => {}, closeWindow: async () => {} },
            shortcuts: { get: async () => ({ ...snapshot, status: 'ready' }),
              subscribe: () => () => {}, recording: async () => {},
              edit: async () => ({ status: 'not-ready', snapshot }) },
          } })
          const mark = () => { document.documentElement.setAttribute('data-platform', value) }
          if (document.documentElement === null) document.addEventListener('DOMContentLoaded', mark, { once: true })
          else mark()
        }, { value: platform, snapshot: initialShortcutConfig() })
      }
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('textbox', { name: 'Choose workspace', exact: true }).waitFor()
      const sessionHeader = page.locator('[data-slot="conversation.session.header"]')
      expect(await sessionHeader.count()).toBe(0)
      const header = page.locator('[data-slot="conversation.header"] > header')
      expect(await header.evaluate(element => element.getBoundingClientRect().height)).toBe(0)
      expect(await page.getByRole('button', { name: /^(Open|Collapse) sidebar$/ }).count()).toBe(0)
      for (const width of [1440, 1180, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await expect.poll(() => page.locator('[data-slot="sidebar"]').evaluate(element => element.closest('[class*="sidebarCol"]')!.getBoundingClientRect().width)).toBe(236)
        expect(await sessionHeader.count()).toBe(0)
        expect(await header.evaluate(element => element.getBoundingClientRect().height)).toBe(0)
      }
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    } catch (error) {
      await saveFailureShot(page, `sessionless-header-${platform}`)
      throw error
    } finally {
      await page.close()
    }
  })
})
