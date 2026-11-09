/** The shipped company route must reach the model editor without a user-created override. */
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE } from './support.ts'

it('shows Anthropic Messages and the gateway root for the built-in company provider', async () => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
  const console = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await openSettings(page, 'zh')
  const dialog = page.getByRole('dialog', { name: '设置' })
  await dialog.getByRole('button', { name: '模型', exact: true }).click()
  await dialog.getByRole('button', { name: '编辑 HaierCash (company-gateway)', exact: true }).click()
  await dialog.getByText('自定义设置', { exact: true }).click()
  expect(await dialog.getByLabel('API 地址', { exact: true }).getAttribute('placeholder')).toContain('http://ai-gateway.haierxj.cn')
  expect(await dialog.getByLabel('API 协议', { exact: true }).inputValue()).toBe('anthropic-messages')
  expect(console.pageErrors).toEqual([])
  const artifacts = fileURLToPath(new URL('../../../.artifacts/company-gateway/', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  const run = await mkdtemp(join(artifacts, 'run-'))
  await page.screenshot({ path: join(run, 'anthropic-defaults.png'), fullPage: true })
})
