import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const TAB_TARGET_ID = 'doclib-tab-target-session'
const TAB_TARGET_TITLE = '文档 tab target session'
const TAB_DECOY_ID = 'doclib-tab-decoy-session'
// Written by no Session: the decoy exists to own the library's default paint.
const TAB_DECOY = createChatScrollFixture({
  markerPrefix: 'DOCLIB_TAB_DECOY',
  title: 'DOCLIB_TAB decoy session',
  turns: 1,
})

it('indexes recorded session documents through the bundled document library', async () => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const entries = [...scaffold.ctx.loader.entries()]
    .filter(entry => entry.options.name === '@local/dsh-plugin-doclib')
  expect(entries).toHaveLength(1)
  expect(entries[0]!.disabled).toBe(false)
  const fixture = fileURLToPath(new URL('../../../snapshots/web/changed-files-turn/', import.meta.url))
  await cp(join(fixture, 'workspace.expected'), scaffold.workspaceCwd, { recursive: true })
  await seedSession(scaffold, await readFile(join(fixture, 'session.v4.jsonl'), 'utf8'), 'doclib-recorded-session')
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  const console = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('button', { name: '文档库', exact: true }).click()
  await page.getByRole('heading', { name: '文档库', exact: true }).waitFor()
  await page.getByRole('button', { name: '重建索引', exact: true }).click()
  await page.getByText('intro.md', { exact: true }).waitFor()
  const response = await page.request.get(new URL('/doclib/status', scaffold.authenticatedUrl).href)
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ error: null, sessions: 1, generated: 3 })
  await page.getByPlaceholder('搜索文件、任务或工作区').fill('项目说明')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.getByRole('button', { name: '返回目录', exact: true }).waitFor()
  await page.getByText('intro.md', { exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'intro.md', exact: true })
  await preview.getByRole('heading', { name: '项目说明', exact: true }).waitFor()
  await preview.getByTitle('关闭', { exact: true }).click()
  await page.getByRole('button', { name: '返回目录', exact: true }).click()
  expect(console.pageErrors).toEqual([])
  const artifacts = fileURLToPath(new URL('../../../.artifacts/doclib/', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  const shots = await mkdtemp(join(artifacts, 'run-'))
  await page.screenshot({ path: join(shots, 'library.png'), fullPage: true })
})

it('opens the library at the Session whose 文档 tab was clicked', async () => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const fixture = fileURLToPath(new URL('../../../snapshots/web/changed-files-turn/', import.meta.url))
  await cp(join(fixture, 'workspace.expected'), scaffold.workspaceCwd, { recursive: true })
  const recorded = await readFile(join(fixture, 'session.v4.jsonl'), 'utf8')
  // The decoy is newer, so the library's first paint opens it instead; the
  // target Session only shows expanded when the tab hands its id to the panel.
  const targetId = await seedSession(scaffold, recorded, TAB_TARGET_ID, undefined, { createdAt: Date.now() - 120_000 })
  await seedSession(scaffold, TAB_DECOY.log, TAB_DECOY_ID)
  await scaffold.ctx.sessionController.rename({ sessionId: targetId, title: TAB_TARGET_TITLE })
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })

  const group = page.locator('[role="treeitem"]').first()
  await group.waitFor({ timeout: 15_000 })
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
  const target = page.getByRole('treeitem').filter({ hasText: TAB_TARGET_TITLE })
  await target.click()
  await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor({ timeout: 30_000 })

  await page.getByRole('tab', { name: '文档', exact: true }).click()
  await page.getByRole('heading', { name: '文档库', exact: true }).waitFor({ timeout: 30_000 })
  // The bootstrap index predates the seeded sessions; rebuilding is the same
  // manual step the panel's own test needs, and the pending request must
  // survive it to reveal the Session.
  await page.getByRole('button', { name: '重建索引', exact: true }).click()
  const block = page.locator(`[data-doclib-session="${TAB_TARGET_ID}"]`)
  await block.waitFor({ timeout: 30_000 })
  await expect.poll(() => block.locator('.dsh-dl-caret').textContent(), { timeout: 10_000 }).toBe('▾')
  await block.getByText('intro.md', { exact: true }).waitFor({ timeout: 15_000 })

  // Returning must land on Chat: a doorway View left selected would bounce
  // every later visit to this Session straight back to the library.
  await target.click()
  await expect.poll(
    () => page.getByRole('tab', { name: 'Chat', exact: true }).getAttribute('aria-selected'),
    { timeout: 15_000 },
  ).toBe('true')
  expect(await page.getByRole('heading', { name: '文档库', exact: true }).count()).toBe(0)
  expect(tripwire.pageErrors).toEqual([])
})
