/** Exercise the bundled kit through the real Web carrier without calling a model API. */
import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

it('browses native Claude history and uses company models for a new session', async () => {
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
  execFileSync('git', ['init', '--quiet', scaffold.workspaceCwd])
  await writeFile(join(scaffold.workspaceCwd, 'claude-preview.txt'), 'Preview fixture change\n')
  const sessionId = '49be37e0-fc3f-4fe0-a57a-f678a963effa'
  const projectDir = join(scaffold.harnessHome, 'claude-native', 'projects', scaffold.workspaceCwd.replace(/[^a-zA-Z0-9]/g, '-'))
  await mkdir(projectDir, { recursive: true })
  const nativeFile = join(projectDir, `${sessionId}.jsonl`)
  const nativeMessage = (uuid: string, parentUuid: string | null, type: 'user' | 'assistant', text: string) => ({
    uuid, parentUuid, sessionId, cwd: scaffold.workspaceCwd, isSidechain: false,
    timestamp: '2026-11-09T00:00:00.000Z', type,
    message: { role: type, content: [{ type: 'text', text }] },
  })
  await writeFile(nativeFile, [
    nativeMessage('cf10170f-cb2d-40fc-a0e4-bd7d64b200ea', null, 'user', 'Native session fixture'),
    nativeMessage('3341feeb-4d9d-4148-b25a-f4c7c34f605b', 'cf10170f-cb2d-40fc-a0e4-bd7d64b200ea', 'assistant', 'Saved native reply'),
  ].map(row => JSON.stringify(row)).join('\n') + '\n')
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: ZH_BROWSER_LOCALE })
  const console = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Claude', exact: true }).click()
  await page.getByRole('button', { name: '选择项目', exact: true }).click()
  const projects = page.getByRole('dialog', { name: '项目', exact: true })
  await projects.getByRole('textbox', { name: '搜索项目', exact: true }).fill(basename(scaffold.workspaceCwd))
  await projects.getByRole('button', { name: `${basename(scaffold.workspaceCwd)} ${scaffold.workspaceCwd}`, exact: true }).click()
  await page.getByRole('button', { name: '选择会话', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Native session fixture', exact: true }).click()
  await page.getByText('Saved native reply', { exact: true }).waitFor()
  await page.getByRole('navigation', { name: '文件', exact: true }).getByText('claude-preview.txt', { exact: true }).click()
  await page.getByRole('region', { name: '文件预览', exact: true }).getByText('Preview fixture change', { exact: false }).first().waitFor()
  await page.getByRole('button', { name: '返回聊天', exact: true }).click()
  const changes = page.getByRole('complementary', { name: '改动', exact: true })
  await changes.getByRole('button', { name: 'claude-preview.txt 新增', exact: true }).click()
  await changes.getByText('Preview fixture change', { exact: false }).first().waitFor()
  await appendFile(nativeFile, JSON.stringify(nativeMessage('7d29f8ad-9400-447b-9335-00861972325d', '3341feeb-4d9d-4148-b25a-f4c7c34f605b', 'assistant', 'Reply appended outside the app')) + '\n')
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByText('Reply appended outside the app', { exact: true }).waitFor()
  await page.getByRole('button', { name: '新建会话', exact: true }).click()
  await page.getByText('GLM fixture', { exact: true }).waitFor()
  // The missing path belongs to this test's temporary workspace, regardless of installed CLIs.
  const environment = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: '运行环境' }) })
  if (await environment.getAttribute('open') === null) await environment.locator('summary').click()
  await page.getByLabel('Claude CLI 绝对路径（留空使用 PATH）').fill(join(scaffold.workspaceCwd, 'missing-claude'))
  await page.getByRole('button', { name: '保存并检测', exact: true }).click()
  await page.getByText('CLI was not found, is not executable, or failed to start. Install Claude Code yourself or select its absolute executable path.', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Do not send this fixture')
  expect(await page.getByRole('button', { name: '发送', exact: true }).isDisabled()).toBe(true)
  expect(await page.getByRole('alert').count()).toBe(0)
  expect(console.pageErrors).toEqual([])
  const artifacts = fileURLToPath(new URL('../../../.artifacts/claude/', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  const run = await mkdtemp(join(artifacts, 'run-'))
  await page.screenshot({ path: join(run, 'bundled-claude.png'), fullPage: true })
})
