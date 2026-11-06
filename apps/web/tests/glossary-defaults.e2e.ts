/** The shipped profile loads the bundled glossary without a local plugin link. */
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage, openSettings } from './support.ts'

it('enables the glossary while hiding built-in plugin settings and disabling the session pool', async () => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const entries = [...scaffold.ctx.loader.entries()]
  const glossary = entries.filter(entry => entry.options.name === 'hi-buddy-glossary-kit')
  const pool = entries.filter(entry => entry.options.name === 'hi-buddy-session-pool-kit')
  expect(glossary).toHaveLength(1)
  expect(glossary[0]!.disabled).toBe(false)
  expect(pool).toHaveLength(1)
  expect(pool[0]!.disabled).toBe(true)
  const pluginSettings = entries.filter(entry => entry.options.name === '@deepseek-ai/dsh-client-ui-settings-plugins')
  expect(pluginSettings).toHaveLength(1)
  expect(pluginSettings[0]!.disabled).toBe(true)
  const browser = await chromium.launch()
  try {
    const page = await newEnglishPage(browser)
    const console = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'Haixiao glossary', exact: true }).click()
    await page.getByRole('heading', { name: 'Haixiao glossary', exact: true }).waitFor()
    for (const name of ['够花', '海智伙伴']) {
      const toggle = page.getByRole('switch', { name: `${name} · Enable AI lookup`, exact: true })
      await toggle.waitFor()
      expect(await toggle.getAttribute('aria-checked')).toBe('true')
    }
    await openSettings(page, 'en')
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('button', { name: 'General', exact: true }).waitFor()
    expect(await settings.getByRole('button', { name: 'Built-in plugins', exact: true }).count()).toBe(0)
    expect(console.pageErrors).toEqual([])
  } finally {
    await browser.close()
  }
})
