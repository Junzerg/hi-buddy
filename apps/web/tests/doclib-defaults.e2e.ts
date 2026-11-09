import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

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
