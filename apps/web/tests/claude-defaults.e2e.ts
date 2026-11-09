/** Exercise the bundled kit through the real Web carrier without calling a model API. */
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

it('opens bundled Claude and reads company model IDs through the Host', async () => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const entries = [...scaffold.ctx.loader.entries()].filter(entry => entry.options.name === 'hi-buddy-claude-kit')
  expect(entries).toHaveLength(1)
  expect(entries[0]!.disabled).toBe(false)
  expect(scaffold.ctx.get('hiBuddyClaude')).toBeDefined()
  // Seed the external IAM result; keep the real account provider and endpoint binding.
  await scaffold.ctx.credentials.modifyRecord(credentialKey('deepseek-account-platform', 'default'), () => Promise.resolve({
    kind: 'grant', payload: { version: 1, token: 'claude-company-fixture', issuer: 'https://iam-stg.haierxj.com' },
  }))
  await scaffold.ctx.settings.mutate('llm-pi-ai', [{
    op: 'set', path: ['providers', 'company-gateway', 'models'],
    value: [{ id: 'volces-glm5', name: 'GLM fixture' }],
  }])
  await expect.poll(() => scaffold.ctx.llm.listModels('company-gateway')).toMatchObject([{ id: 'volces-glm5' }])
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: ZH_BROWSER_LOCALE })
  const console = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Claude', exact: true }).click()
  await page.getByRole('heading', { name: 'Claude', exact: true }).waitFor()
  await page.getByRole('button', { name: 'HaierCash · GLM fixture', exact: true }).waitFor()
  // The missing path belongs to this test's temporary workspace, regardless of installed CLIs.
  const environment = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: '运行环境' }) })
  if (await environment.getAttribute('open') === null) await environment.locator('summary').click()
  await page.getByLabel('Claude CLI 绝对路径（留空使用 PATH）').fill(join(scaffold.workspaceCwd, 'missing-claude'))
  await page.getByRole('button', { name: '保存并检测', exact: true }).click()
  await page.getByText('CLI was not found, is not executable, or failed to start. Install Claude Code yourself or select its absolute executable path.', { exact: true }).waitFor()
  await page.getByLabel('本机工作目录（绝对路径）').fill(scaffold.workspaceCwd)
  expect(await page.getByRole('button', { name: '创建会话', exact: true }).isDisabled()).toBe(true)
  expect(await page.getByRole('alert').count()).toBe(0)
  expect(console.pageErrors).toEqual([])
  const artifacts = fileURLToPath(new URL('../../../.artifacts/claude/', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  const run = await mkdtemp(join(artifacts, 'run-'))
  await page.screenshot({ path: join(run, 'bundled-claude.png'), fullPage: true })
})
