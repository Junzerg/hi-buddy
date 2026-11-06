/** The opt-in kit loads beside the full Web UI and connects independent workspaces. */
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

class PoolAdapter extends LlmAdapter {
  readonly calls: GenerateOptions[] = []
  override async listModels(provider: string) { return [{ provider, id: 'pool', name: 'Pool test model', contextWindow: 128000 }] }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model, context: { contextWindow: 128000 } }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    yield { type: 'text-delta', index: 0, text: 'Project check complete.' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it('joins through the shipped menu, relays across workspaces, and revokes membership', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/session-pool.patch.yml', import.meta.url)),
  })
  onTestFinished(() => scaffold.close())
  const { ctx } = scaffold
  const adapter = new PoolAdapter()
  ctx.effect(() => ctx.llm.registerAdapter(['pool-test'], adapter))
  await ctx.agentDefaultModel.saveSelection({ provider: 'pool-test', model: 'pool' })
  const secondCwd = join(scaffold.workspaceCwd, 'project-b')
  await mkdir(secondCwd)
  const workspaces = await Promise.all([scaffold.workspaceCwd, secondCwd].map(cwd => ctx.workspaceRegistry.create(cwd)))
  const fixture = await readFile(fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url)), 'utf8')
  const sessions = []
  for (const [index, workspace] of workspaces.entries()) {
    const sessionId = await seedSession({ ...scaffold, workspaceCwd: index === 0 ? scaffold.workspaceCwd : secondCwd }, fixture, `pool-project-${index}`)
    await workspace.attachSession(sessionId)
    await ctx.sessionController.selectModel({ sessionId, provider: 'pool-test', model: 'pool' })
    await ctx.sessionController.rename({ sessionId, title: `Pool project ${index + 1}` })
    sessions.push(sessionId)
  }
  const [aId, bId] = sessions
  if (!aId || !bId) throw new Error('Both pool sessions must exist')
  const resolved = await ctx.sessionController.resolveAgent(aId)
  if ('error' in resolved) throw new Error(resolved.error.message)
  const run = (name: string, args: Record<string, unknown> = {}) => executeModelToolFixture(ctx, {
    agent: resolved.agent, name, arguments: args, callId: ToolCallId(randomUUID()), signal: new AbortController().signal,
  })
  expect((await run('session_pool_list')).isError).toBe(true)
  const browser = await chromium.launch()
  try {
    const page = await newEnglishPage(browser)
    await mkdir(join(import.meta.dirname, '../../../.artifacts/session-pool'), { recursive: true })
    const shots = await mkdtemp(join(import.meta.dirname, '../../../.artifacts/session-pool/run-'))
    const console = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const menuFor = async (index: number) => {
      const title = `Pool project ${index}`
      const row = page.getByRole('treeitem').filter({ has: page.getByText(title, { exact: true }) })
      const workspaceRow = page.getByRole('treeitem').filter({ has: page.getByText(workspaces[index - 1]!.title, { exact: true }) })
      if (await workspaceRow.getAttribute('aria-expanded') !== 'true') await workspaceRow.click()
      await row.hover()
      await row.getByRole('button', { name: `Session actions for ${title}`, exact: true }).click()
    }
    expect(await page.getByRole('img', { name: 'Joined task pool', exact: true }).count()).toBe(0)
    for (const index of [1, 2]) {
      await menuFor(index)
      await page.getByRole('menuitem', { name: 'Join task pool', exact: true }).click()
      await page.getByRole('menu').waitFor({ state: 'hidden' })
      await expect.poll(() => page.getByRole('img', { name: 'Joined task pool', exact: true }).count()).toBe(index)
    }
    const list = await run('session_pool_list')
    expect(list.isError).toBe(false)
    expect(list.value).toMatchObject({ sessions: [{ sessionId: bId, sessionTitle: 'Pool project 2', workspaceTitle: workspaces[1]!.title }] })
    expect((await run('session_pool_send', { sessionId: bId, text: 'Check project B integration.' })).value)
      .toMatchObject({ ok: true, status: 'accepted' })
    const target = await ctx.sessionController.resolveAgent(bId)
    if ('error' in target) throw new Error(target.error.message)
    await target.agent.whenIdle()
    await expect.poll(() => adapter.calls.length).toBeGreaterThanOrEqual(2)
    await expect.poll(async () => (await run('session_pool_list')).value)
      .toMatchObject({ sessions: [{ sessionId: bId, summary: 'Project check complete.' }] })
    expect(JSON.stringify(adapter.calls[0]!.messages)).toContain('Check project B integration.')
    await page.getByRole('button', { name: 'Task pool', exact: true }).click()
    const poolPage = page.getByRole('region', { name: 'Task pool', exact: true })
    await poolPage.getByText('2 members', { exact: true }).waitFor()
    await poolPage.getByText('Project check complete.', { exact: true }).waitFor()
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/session-pool/members.expected.md', import.meta.url)),
      (await poolPage.ariaSnapshot()).replaceAll(workspaces[0]!.title, 'Workspace A').replaceAll(workspaces[1]!.title, 'Workspace B'),
      webSnapshotMode())
    await page.getByText('Joined task pool', { exact: true }).waitFor({ state: 'hidden' })
    await page.screenshot({ path: join(shots, 'members.png'), fullPage: true })
    await poolPage.getByRole('button', { name: 'Open conversation · Pool project 2', exact: true }).click()
    await expect.poll(() => page.getByRole('treeitem', { selected: true }).textContent()).toContain('Pool project 2')
    await page.reload({ waitUntil: 'load' })
    await menuFor(2)
    await page.getByRole('menuitem', { name: 'Leave task pool', exact: true }).waitFor()
    await page.screenshot({ path: join(shots, 'menu.png'), fullPage: true })
    await page.getByRole('menuitem', { name: 'Leave task pool', exact: true }).click()
    const secondRow = page.getByRole('treeitem').filter({ has: page.getByText('Pool project 2', { exact: true }) })
    await expect.poll(() => secondRow.getByRole('img', { name: 'Joined task pool', exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: 'Task pool', exact: true }).click()
    await poolPage.getByText('1 members', { exact: true }).waitFor()
    expect((await run('session_pool_list')).value).toEqual({ sessions: [] })
    expect((await run('session_pool_send', { sessionId: bId, text: 'Must not arrive.' })).value).toMatchObject({ ok: false })
    expect(console.pageErrors).toEqual([])
  } finally {
    await browser.close()
  }
})
