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
  const nativeMessage = (uuid: string, parentUuid: string | null, type: 'user' | 'assistant', content: string | object[]) => ({
    uuid, parentUuid, sessionId, cwd: scaffold.workspaceCwd, isSidechain: false,
    timestamp: '2026-11-09T00:00:00.000Z', type,
    message: { role: type, content: typeof content === 'string' ? [{ type: 'text', text: content }] : content },
  })
  await writeFile(nativeFile, [
    nativeMessage('cf10170f-cb2d-40fc-a0e4-bd7d64b200ea', null, 'user', 'Native session fixture'),
    nativeMessage('3341feeb-4d9d-4148-b25a-f4c7c34f605b', 'cf10170f-cb2d-40fc-a0e4-bd7d64b200ea', 'assistant', [
      { type: 'thinking', thinking: 'Inspect the fixture before replying.' },
      { type: 'tool_use', id: 'toolu_fixture', name: 'Read', input: { file_path: 'claude-preview.txt' } },
    ]),
    nativeMessage('33162dc3-80b3-47f0-9b79-07268949db43', '3341feeb-4d9d-4148-b25a-f4c7c34f605b', 'user', [
      { type: 'tool_result', tool_use_id: 'toolu_fixture', content: 'Native Read result' },
    ]),
    nativeMessage('cbfdc41f-7ba0-4e6e-abf7-9dffca413388', '33162dc3-80b3-47f0-9b79-07268949db43', 'assistant', 'Saved native reply'),
  ].map(row => JSON.stringify(row)).join('\n') + '\n')
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, locale: ZH_BROWSER_LOCALE })
  const console = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Claude', exact: true }).click()
  await page.getByRole('button', { name: '选择项目', exact: true }).click()
  const projects = page.getByRole('dialog', { name: '项目', exact: true })
  await projects.getByRole('textbox', { name: '搜索项目', exact: true }).fill(basename(scaffold.workspaceCwd))
  await projects.getByRole('button', { name: `${basename(scaffold.workspaceCwd)} ${scaffold.workspaceCwd}`, exact: true }).click()
  const sessions = page.getByRole('navigation', { name: '会话', exact: true })
  const chat = page.getByRole('main', { name: '聊天', exact: true })
  const composer = chat.getByRole('textbox', { name: '消息', exact: true })
  await chat.getByRole('button', { name: '选择会话', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Native session fixture', exact: true }).click()
  await page.getByText('Saved native reply', { exact: true }).waitFor()
  expect(await sessions.getByRole('button', { name: 'Native session fixture', exact: true }).getAttribute('aria-current')).toBe('page')
  const artifacts = fileURLToPath(new URL('../../../.artifacts/claude/', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  const run = await mkdtemp(join(artifacts, 'run-'))
  const thinking = chat.getByRole('button', { name: '思考过程', exact: true })
  const thought = chat.getByText('Inspect the fixture before replying.', { exact: true })
  await thinking.click()
  await thought.waitFor()
  await thinking.click()
  await thought.waitFor({ state: 'hidden' })
  const read = chat.getByRole('button', { name: /^读取.*claude-preview\.txt.*已完成/ })
  await read.click()
  await chat.getByText('Native Read result', { exact: true }).waitFor()
  await page.screenshot({ path: join(run, 'session-transcript.png'), fullPage: true })
  await read.click()
  await chat.getByRole('button', { name: '文件', exact: true }).click()
  const files = page.getByRole('complementary', { name: '文件', exact: true })
  await files.getByText('claude-preview.txt', { exact: true }).click()
  const preview = files.getByRole('region', { name: '文件预览', exact: true })
  await preview.getByText('Preview fixture change', { exact: false }).first().waitFor()
  await composer.waitFor()
  await page.screenshot({ path: join(run, 'workspace-files.png'), fullPage: true })

  await chat.getByRole('button', { name: '改动', exact: true }).click()
  const changes = page.getByRole('complementary', { name: '改动', exact: true })
  await changes.getByRole('button', { name: 'claude-preview.txt 新增', exact: true }).click()
  await changes.getByText('Preview fixture change', { exact: false }).first().waitFor()
  await composer.fill('Existing draft')
  await changes.getByRole('button', { name: '反馈第 1 行附近的改动', exact: true }).click()
  await changes.getByRole('textbox', { name: '写下希望 Claude 调整的内容', exact: true }).fill('Check the preview text')
  await changes.getByRole('button', { name: '加入输入框', exact: true }).click()
  expect(await composer.inputValue()).toBe('Existing draft\n\n请查看 claude-preview.txt:1 的改动。Check the preview text')
  await page.screenshot({ path: join(run, 'workspace-diff.png'), fullPage: true })
  await changes.getByRole('button', { name: '查看文件', exact: true }).click()
  await preview.getByText('Preview fixture change', { exact: false }).first().waitFor()
  await files.getByRole('button', { name: '关闭面板', exact: true }).click()
  await appendFile(nativeFile, JSON.stringify(nativeMessage('7d29f8ad-9400-447b-9335-00861972325d', 'cbfdc41f-7ba0-4e6e-abf7-9dffca413388', 'assistant', 'Reply appended outside the app')) + '\n')
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByText('Reply appended outside the app', { exact: true }).waitFor()
  await chat.getByRole('button', { name: '新建会话', exact: true }).click()
  await page.getByText('GLM fixture', { exact: true }).waitFor()
  expect(await page.getByText('运行环境', { exact: true }).count()).toBe(0)
  const contextCommand = page.getByRole('menuitem', { name: /^\/context/ })
  const compactCommand = page.getByRole('menuitem', { name: /^\/compact/ })
  await composer.fill('/')
  await contextCommand.waitFor()
  await compactCommand.waitFor()
  await page.getByRole('menuitem', { name: /^\/code-review/ }).waitFor()
  await page.screenshot({ path: join(run, 'slash-commands.png'), fullPage: true })
  await composer.fill('/comp')
  await contextCommand.waitFor({ state: 'hidden' })
  await compactCommand.waitFor()
  await composer.press('Enter')
  expect(await composer.inputValue()).toBe('/compact ')
  await compactCommand.waitFor({ state: 'hidden' })
  await composer.fill('/compact keep the date logic')
  await expect.poll(() => page.getByRole('button', { name: '发送', exact: true }).isEnabled()).toBe(true)
  expect(await page.getByRole('alert').count()).toBe(0)
  expect(console.pageErrors).toEqual([])
})
