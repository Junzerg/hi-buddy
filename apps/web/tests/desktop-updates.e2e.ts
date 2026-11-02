/** Built workspace chrome with a controlled Desktop carrier; no Electron or installer is exercised. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Locator } from 'playwright'
import { describe, expect, it } from 'vitest'
import { presentDesktopUpdate } from '../../desktop/src/update-presentation.ts'
import { en } from '../../desktop/src/locale.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { saveFailureShot } from './support.ts'

// Mirrors the preload's presentation-only API; importing Client projects would mix compiler faces.
type Presentation = ReturnType<typeof presentDesktopUpdate>
interface CarrierFixture {
  publish(state: Presentation): void
  opens: number
  listeners: Set<(state: Presentation) => void>
}
type FixtureWindow = Window & typeof globalThis & { updateFixture: CarrierFixture }

describe('web e2e: Desktop update workspace chrome', () => {
  it.each(['zh-CN', 'en-US'])('renders update states and routes explicit actions in %s', async (locale) => {
    const browserEnvironment = { ...process.env }
    const scaffold = await launchWebScaffold({})
    try {
      const browser = await chromium.launch({ env: browserEnvironment })
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale })
        await page.addInitScript(() => {
          let current: Presentation = { phase: 'idle' }
          const listeners = new Set<(state: Presentation) => void>()
          const fixture: CarrierFixture = {
            opens: 0, listeners,
            publish(state) { current = state; for (const listener of listeners) listener(state) },
          }
          Object.assign(window, {
            updateFixture: fixture,
            dshDesktop: { protocolVersion: 1, updates: {
              status: async () => current,
              open: async () => { fixture.opens += 1 },
              subscribe(listener: (state: Presentation) => void) { listeners.add(listener); return () => listeners.delete(listener) },
            } },
          })
        })
        const tripwire = watchConsole(page)
        const evidenceRoot = fileURLToPath(new URL('../../desktop/.desktop-build/qualification/', import.meta.url))
        await mkdir(evidenceRoot, { recursive: true })
        const evidence = await mkdtemp(join(evidenceRoot, `workspace-updates-${locale}-`))
        try {
          await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
          await page.waitForSelector('[class*="frame"]')
          await expect.poll(() => page.evaluate(() => (window as FixtureWindow).updateFixture.listeners.size)).toBe(1)
          const availableLabel = locale === 'zh-CN' ? '新版本' : 'Update'
          const retryLabel = locale === 'zh-CN' ? '重试更新' : 'Retry update'
          const errorDetail = locale === 'zh-CN' ? '下载更新失败，请重试。' : 'Could not download the update. Please try again.'
          const readyLabel = locale === 'zh-CN' ? '安装并重启' : 'Install and Restart'
          const version = '0.1.5-nightly.20260911'
          // The carrier classification deliberately uses English shell copy; Web copy follows its own locale.
          const available = presentDesktopUpdate({ phase: 'available', version }, en)
          const publish = async (state: Presentation) => page.evaluate((value) => {
            (window as FixtureWindow).updateFixture.publish(value)
          }, state)
          const opens = async () => page.evaluate(() => (window as FixtureWindow).updateFixture.opens)
          await publish(available)
          const update = page.getByRole('button', { name: availableLabel, exact: true })
          await update.waitFor()
          expect(await opens()).toBe(0)
          const geometry = await update.boundingBox()
          expect(geometry).not.toBeNull()
          expect(geometry!.x).toBeLessThan(350)
          expect(geometry!.y).toBeGreaterThan(650)
          const account = page.getByRole('button', { name: locale === 'zh-CN' ? '账号菜单' : 'Account menu', exact: true })
          const footerLabels = locale === 'zh-CN' ? ['通知', '意见反馈', '设置'] : ['Notifications', 'Feedback', 'Settings']
          const assertFooterRow = async (indicator: Locator) => {
            const status = await indicator.boundingBox()
            expect(status).not.toBeNull()
            expect(status!.width).toBe(geometry!.width)
            const row = [status!]
            for (const control of [account, ...footerLabels.map(label => page.getByRole('button', { name: label, exact: true }))]) {
              const bounds = await control.boundingBox()
              expect(bounds).not.toBeNull()
              expect(Math.abs(bounds!.y + bounds!.height / 2 - status!.y - status!.height / 2)).toBeLessThanOrEqual(1)
              row.push(bounds!)
            }
            row.sort((left, right) => left.x - right.x)
            for (let index = 1; index < row.length; index++) {
              const previous = row[index - 1]
              expect(previous.x + previous.width).toBeLessThanOrEqual(row[index].x)
            }
            expect(row[0].x).toBeGreaterThanOrEqual(0)
            expect(row.at(-1)!.x + row.at(-1)!.width).toBeLessThanOrEqual(236)
            expect(await indicator.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
          }
          await assertFooterRow(update)
          await page.setViewportSize({ width: 390, height: 800 })
          await assertFooterRow(update)
          await page.setViewportSize({ width: 1280, height: 800 })
          await page.screenshot({ path: join(evidence, 'available.png') })
          await saveFailureShot(page, `desktop-update-footer-${locale}-preview`)
          for (const [phase, labelZh, labelEn] of [
            ['checking', '正在检查更新…', 'Checking for updates…'],
            ['verifying', '正在校验更新文件…', 'Verifying update files…'],
            ['installing', '正在准备重启…', 'Preparing to restart…'],
          ] as const) {
            await publish(presentDesktopUpdate({ phase, version }, en))
            const label = locale === 'zh-CN' ? labelZh : labelEn
            const busy = page.getByRole('button', { name: label, exact: true })
            await busy.waitFor()
            await assertFooterRow(busy)
            if (phase === 'installing') {
              await page.setViewportSize({ width: 390, height: 800 })
              await assertFooterRow(busy)
              await busy.hover()
              await expect.poll(() => page.getByRole('tooltip').allTextContents()).toContain(`${label}\n${version}`)
              await saveFailureShot(page, `desktop-update-footer-${locale}-restart-preview`)
              await page.mouse.move(350, 100)
              await page.setViewportSize({ width: 1280, height: 800 })
            }
          }
          await publish(available)
          await update.waitFor()
          await update.click()
          await expect.poll(opens).toBe(1)

          const progress = presentDesktopUpdate({ phase: 'downloading', version, percent: 58 }, en)
          await publish(progress)
          const downloading = page.getByRole('button', { name: '58%', exact: true })
          await downloading.waitFor()
          await assertFooterRow(downloading)
          expect(await downloading.getAttribute('aria-disabled')).toBe('true')
          expect(await downloading.locator('svg').count()).toBe(1)
          // Force dispatch past Playwright's aria-disabled guard to verify the product's click guard.
          await downloading.click({ force: true })
          expect(await opens()).toBe(1)
          await page.screenshot({ path: join(evidence, 'downloading.png') })

          const updateBackground = await downloading.evaluate(element => getComputedStyle(element).backgroundColor)
          const error = presentDesktopUpdate({ phase: 'error', version, failedOperation: 'download', message: 'HTTP 503' }, en)
          await publish(error)
          const retry = page.getByRole('button', { name: retryLabel, exact: true })
          await retry.waitFor()
          await assertFooterRow(retry)
          const failedBackground = await retry.evaluate(element => getComputedStyle(element).backgroundColor)
          expect(failedBackground).toBe(updateBackground)
          const tooltip = page.getByRole('tooltip', { name: errorDetail, exact: true })
          await page.mouse.move(400, 100)
          await retry.hover()
          await expect.poll(() => tooltip.evaluateAll(elements => elements.map(element => getComputedStyle(element).opacity))).toEqual(['1'])
          await page.screenshot({ path: join(evidence, 'retry.png') })
          await retry.click()
          await expect.poll(opens).toBe(2)

          await publish(presentDesktopUpdate({ phase: 'ready', version }, en))
          const ready = page.getByRole('button', { name: readyLabel, exact: true })
          await ready.waitFor()
          await assertFooterRow(ready)
          expect(await ready.getAttribute('aria-disabled')).toBe('false')
          expect(await opens()).toBe(2)
          await page.screenshot({ path: join(evidence, 'ready.png') })
          await ready.click()
          await expect.poll(opens).toBe(3)
          expect(tripwire.pageErrors).toEqual([])
          expect(tripwire.warnings).toEqual([])
          expect(await page.evaluate(() => (window as FixtureWindow).updateFixture.listeners.size)).toBe(1)
          await writeFile(join(evidence, 'result.json'), JSON.stringify({ locale, geometry, updateBackground, failedBackground,
            passed: true, explicitActions: 3, carrier: 'substituted', host: 'real Web composition',
            electron: false, installerExecuted: false }, null, 2) + '\n')
          console.log(`Desktop workspace chrome evidence: ${evidence}`)
        } catch (error) {
          await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => undefined)
          throw error
        }
      } finally { await browser.close() }
    } finally { await scaffold.close() }
  })
})
