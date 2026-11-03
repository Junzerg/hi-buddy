// Recorded-session Sidebar geometry and per-Session view state through the shipped browser composition.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, compareOrRefreshGolden,
  fixtureUserPrompts, launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/details-session-lifecycle', import.meta.url))
const HANDLES_EXPECTED = join(SNAPSHOT_DIR, 'handles.expected.md')
const SIDEBAR_EXPECTED = join(SNAPSHOT_DIR, 'sidebar.expected.md')
const BLANK_EXPECTED = join(SNAPSHOT_DIR, 'blank-session.expected.md')
const SHOT_DIR = fileURLToPath(new URL('../../../.artifacts/screenshots/0907-sidebar-rules', import.meta.url))
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url))
const SEED_FIXTURE = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'
const MODE = webSnapshotMode()

/** Last AppFrame grid track in CSS pixels. */
async function detailsTrack(page: Page): Promise<number> {
  return await appFrame(page).evaluate((element) => {
    const tracks = getComputedStyle(element).gridTemplateColumns.split(' ')
    return Number.parseFloat(tracks.at(-1) ?? 'NaN')
  })
}

/** First AppFrame grid track in CSS pixels. */
async function sidebarTrack(page: Page): Promise<number> {
  return await appFrame(page).evaluate((element) => {
    const tracks = getComputedStyle(element).gridTemplateColumns.split(' ')
    return Number.parseFloat(tracks[0] ?? 'NaN')
  })
}

/** AppFrame is the only product element with an sidebar track width property. */
function appFrame(page: Page) {
  return page.locator('[style*="--dsh-sidebar-track-width"]').first()
}

/** Record fixed outer widths and the absence of resize affordances. */
async function handleSnapshot(page: Page): Promise<string> {
  const frame = appFrame(page)
  const sidebarWidth = await sidebarTrack(page)
  const panelWidth = await frame.locator('[data-sidebar-right-panel]').evaluate(element => getComputedStyle(element).width)
  const handles = await frame.locator('[data-side="sidebar"], [data-side="rightbar"]').count()
  return [
    '# AppFrame outer columns', '',
    `- sidebar width: ${sidebarWidth}px`,
    `- normal right panel width: ${panelWidth}`,
    `- column resize handles: ${handles}`,
  ].join('\n')
}

/** Rendered frame tracks, rounded only to remove browser subpixel allocation. */
async function columns(page: Page): Promise<number[]> {
  return await appFrame(page).evaluate(element =>
    getComputedStyle(element).gridTemplateColumns.split(' ').map(value => Math.round(Number.parseFloat(value))))
}

/** Select panes by visual column rather than retained-host DOM order. */
function paneAt(column: Locator, index: number): Locator {
  return column.locator(`[data-dockkit-pane][data-dockkit-column="${index}"]`)
}

/** Tab order and selection inside each docked pane, independent of generated ids. */
async function paneSnapshot(page: Page) {
  return await page.locator('[data-rightbar-col] [data-dockkit-pane]').evaluateAll(panes => panes
    .sort((left, right) => Number(left.getAttribute('data-dockkit-column')) - Number(right.getAttribute('data-dockkit-column')))
    .map(pane => ({
      active: pane.hasAttribute('data-dockkit-pane-active'),
      tabs: [...pane.querySelectorAll('[data-dockkit-tab]')].map(tab => ({
        title: tab.querySelector('[data-dockkit-tab-title]')?.textContent?.trim(),
        selected: tab.getAttribute('aria-selected') === 'true',
      })),
    })))
}

/** Product-visible geometry, pane state, and expanded Files directories at a settled checkpoint. */
async function sidebarSnapshot(page: Page) {
  await appFrame(page).evaluate(async (frame) => {
    await Promise.allSettled(frame.getAnimations().map(animation => animation.finished))
  })
  const geometry = await appFrame(page).evaluate((frame) => {
    const panel = frame.querySelector<HTMLElement>('[data-sidebar-right-panel]')
    if (panel === null) throw new Error('Sidebar panel is not mounted')
    const expanded = panel.hasAttribute('data-sidebar-right-open')
    const rect = panel.getBoundingClientRect()
    const style = getComputedStyle(panel)
    const handle = frame.querySelector('[data-side="rightbar"]')
    return {
      viewport: [window.innerWidth, window.innerHeight],
      columns: getComputedStyle(frame).gridTemplateColumns.split(' ').map(value => Math.round(Number.parseFloat(value))),
      columnTransition: getComputedStyle(frame).transitionProperty,
      expanded,
      mode: panel.getAttribute('data-sidebar-right-panel'),
      panelContentWidth: expanded ? Math.round(Number.parseFloat(style.width)) : 0,
      panelOuterWidth: expanded ? Math.round(rect.width) : 0,
      coversViewport: expanded && rect.x === 0 && rect.y === 0
        && Math.round(rect.width) === window.innerWidth && Math.round(rect.height) === window.innerHeight,
      resizeHandleWidth: handle === null ? 0 : Math.round(handle.getBoundingClientRect().width),
      expandedDirectories: [...panel.querySelectorAll('[data-files-entry="directory"] > button[aria-expanded="true"]')]
        .map(button => button.textContent?.trim()),
    }
  })
  return { ...geometry, panes: await paneSnapshot(page) }
}

describe.skipIf(MODE === 'record')('web e2e: details panel follows the current Session lifecycle', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const sessionEvents: string[] = []

  beforeAll(async () => {
    const fixture = await readFile(FIXTURE, 'utf8')
    expect(fixtureUserPrompts(fixture)).toEqual([PROMPT])
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false })
    await seedSession(scaffold, await readFile(SEED_FIXTURE, 'utf8'), 'details-session-lifecycle-seed')
    scaffold.ctx.on('session/event', (_session, event) => { sessionEvents.push(event.type) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await appFrame(page).waitFor({ timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('retains each Session sidebar and applies fixed columns, overlays, and explicit fullscreen geometry', async () => {
    onTestFailed(async () => {
      await mkdir(SHOT_DIR, { recursive: true })
      await saveFailureShot(page, `screenshots/0907-sidebar-rules/details-session-lifecycle-${MODE}-${process.pid}`)
    })
    await mkdir(SHOT_DIR, { recursive: true })
    const blankColumn = page.locator('[data-rightbar-col]')
    const workspace = join(scaffold.workspaceCwd, 'workspace')
    await writeFile(join(workspace, 'before-chat.md'), '# Before the first message\n\nWorkspace preview is available.\n')
    await page.locator('[data-sidebar-right-expand]').waitFor({ state: 'visible' })
    await page.screenshot({ path: join(SHOT_DIR, `blank-collapsed-${MODE}-${process.pid}.png`), fullPage: true })
    await page.locator('[data-sidebar-right-expand]').click()
    await blankColumn.locator('[data-sidebar-right-guide-entry="files"]').click()
    await blankColumn.locator('[data-files-entry="file"]').getByRole('button', { name: 'before-chat.md', exact: true }).click()
    await blankColumn.getByText('Workspace preview is available.', { exact: true }).waitFor()
    await page.getByText('HiBuddy, here to help', { exact: false }).waitFor()
    const blankPanes = await paneSnapshot(page)
    expect(blankPanes.map(pane => pane.tabs.map(tab => tab.title))).toEqual([['Files', 'before-chat.md']])
    await page.screenshot({ path: join(SHOT_DIR, `blank-preview-${MODE}-${process.pid}.png`), fullPage: true })

    const blankViewport = page.viewportSize()!
    try {
      await blankColumn.locator('[data-sidebar-right-toggle]').click()
      await blankColumn.locator('[data-dockkit-pane]').first().waitFor({ state: 'hidden' })
      await page.setViewportSize({ width: 767, height: blankViewport.height })
      await expect.poll(() => columns(page)).toEqual([236, 531, 0])
      await page.locator('[data-sidebar-right-expand]').click()
      await expect.poll(() => blankColumn.locator('[data-sidebar-right-open]').count()).toBe(1)
      await expect.poll(() => blankColumn.locator('[data-dockkit-host="dock"]:not([hidden])').evaluate(element => getComputedStyle(element).transform))
        .toBe('none')
      await expect.poll(() => blankColumn.locator('[data-sidebar-right-panel]').boundingBox())
        .toEqual({ x: 431, y: 0, width: 336, height: blankViewport.height })
      await blankColumn.getByText('Workspace preview is available.', { exact: true }).waitFor()
      await blankColumn.locator('[data-sidebar-right-toggle]').click()
      await blankColumn.locator('[data-dockkit-pane]').first().waitFor({ state: 'hidden' })
    } finally {
      await page.setViewportSize(blankViewport)
    }
    await expect.poll(() => columns(page)).toEqual([236, blankViewport.width - 236, 0])
    await page.locator('[data-sidebar-right-expand]').click()
    await blankColumn.locator('[data-dockkit-add-tab]').click()
    await blankColumn.locator('[data-sidebar-right-guide-entry="terminal"]')
      .getByRole('button', { name: /^New terminal/u }).click()
    const agent = scaffold.ctx.agents.list().find(agent => agent.session.header.cwd === workspace)
    if (agent === undefined) throw new Error('Blank Session has no workspace Agent')
    await expect.poll(() => scaffold.ctx.terminalController.list(agent.id).map(terminal => terminal.state)).toEqual(['running'])
    await page.locator('.xterm-helper-textarea:visible').click()
    await page.keyboard.insertText('node -e "require(\'fs\').writeFileSync(\'before-chat-terminal.txt\',\'READY\')"')
    await page.keyboard.press('Enter')
    await expect.poll(() => readFile(join(workspace, 'before-chat-terminal.txt'), 'utf8')).toBe('READY')
    expect(sessionEvents).not.toContain('turn/start')
    expect(sessionEvents).not.toContain('user/message')
    await blankColumn.locator('[data-dockkit-tab][aria-selected="true"]').hover()
    // The tab disappears before the Host finishes process cleanup; close responds after quiescence.
    const [closed] = await Promise.all([
      page.waitForResponse('**/api/terminal/close'),
      blankColumn.locator('[data-dockkit-tab][aria-selected="true"] [data-dockkit-tab-close]').click(),
    ])
    expect(await closed.json()).toMatchObject({ result: { ok: true } })
    expect(scaffold.ctx.terminalController.list(agent.id)).toEqual([])
    await blankColumn.locator('[data-dockkit-tab]').filter({ hasText: 'before-chat.md' }).click()
    await compareOrRefreshGolden(BLANK_EXPECTED, [
      '# Blank Session workspace sidebar', '',
      '- No selected Session: expand control absent',
      '- Selected workspace before first message: expand control visible',
      '- Files: before-chat.md opens as a Markdown preview',
      '- Narrow viewport: reopened preview overlays the main column at 336px',
      '- Terminal: writes a file in the selected workspace before any user message or turn', '',
      `\`\`\`json\n${JSON.stringify(await paneSnapshot(page), null, 2)}\n\`\`\``,
    ].join('\n'), MODE)

    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(PROMPT)
    await input.press('Enter')
    await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    expect(await paneSnapshot(page)).toEqual(blankPanes)
    await blankColumn.getByText('Workspace preview is available.', { exact: true }).waitFor()
    for (const title of ['before-chat.md', 'Files']) {
      const tab = blankColumn.locator('[data-dockkit-tab]').filter({ hasText: title })
      await tab.hover()
      await tab.locator('[data-dockkit-tab-close]').click()
    }

    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(await page.getByText('Details', { exact: true }).isVisible()).toBe(false)
    await compareOrRefreshGolden(HANDLES_EXPECTED, await handleSnapshot(page), MODE)

    expect(await sidebarTrack(page)).toBe(236)
    expect(await page.locator('[data-side="sidebar"], [data-side="rightbar"]').count()).toBe(0)

    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await appFrame(page).waitFor({ timeout: 30_000 })
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(await page.getByText('Details', { exact: true }).isVisible()).toBe(false)

    await page.getByRole('button', { name: /^(?:New session|新.*会话)$/ }).last().click()
    await page.getByText('HiBuddy, here to help', { exact: false }).waitFor({ timeout: 15_000 })
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(await page.getByText('Details', { exact: true }).isVisible()).toBe(false)

    const original = page.locator('[role="treeitem"][aria-selected]').filter({ hasText: 'Reply with the single word' }).first()
    await original.click()
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(await page.getByText('Details', { exact: true }).isVisible()).toBe(false)

    const ungrouped = page.getByText('Ungrouped', { exact: true })
    const ungroupedRow = ungrouped.locator('..').locator('..')
    if (await ungroupedRow.getAttribute('aria-expanded') !== 'true') await ungrouped.click()
    await expect.poll(() => ungroupedRow.getAttribute('aria-expanded')).toBe('true')
    // A cold Session's row may still show its cwd until its history loads.
    const seeded = ungroupedRow.locator('..').locator('[role="treeitem"][aria-selected]')
    await expect.poll(() => seeded.count()).toBe(1)
    await seeded.click()
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)

    const viewport = page.viewportSize()
    if (viewport === null) throw new Error('expected a fixed viewport')
    const column = page.locator('[data-rightbar-col]')
    const panel = column.locator('[data-sidebar-right-panel]')
    const panes = column.locator('[data-dockkit-pane]')
    const normalWidth = 336
    const normalColumns = [236, viewport.width - 236 - normalWidth, normalWidth]
    const checkpoints: string[] = ['# Recorded-session Sidebar states']
    const checkpoint = async (label: string): Promise<void> => {
      checkpoints.push(`## ${label}\n\n\`\`\`json\n${JSON.stringify(await sidebarSnapshot(page), null, 2)}\n\`\`\``)
    }
    const select = async (row: Locator, reply: string): Promise<void> => {
      await row.click()
      await expect.poll(() => row.getAttribute('aria-selected')).toBe('true')
      await page.getByText(reply, { exact: true }).waitFor({ timeout: 15_000 })
    }
    const open = async (): Promise<void> => {
      await page.locator('[data-sidebar-right-expand]').click()
      await expect.poll(() => column.locator('[data-sidebar-right-open]').count()).toBe(1)
      await expect.poll(() => columns(page)).toEqual(normalColumns)
      // The panel's slide completes independently of the frame's grid tracks.
      await expect.poll(() => panel.evaluate(element => getComputedStyle(element).transform))
        .toBe('none')
    }
    const close = async (): Promise<void> => {
      await column.locator('[data-sidebar-right-toggle]').click()
      await expect.poll(() => column.locator('[data-sidebar-right-open]').count()).toBe(0)
      // Closing publishes state before the frame's grid transition finishes.
      await appFrame(page).evaluate(async (frame) => {
        await Promise.allSettled(frame.getAnimations().map(animation => animation.finished))
      })
      await expect.poll(() => detailsTrack(page)).toBe(0)
      await panel.locator('[data-dockkit-pane]').first().waitFor({ state: 'hidden' })
    }

    await select(original, 'LIGHTHOUSE')
    await open()
    await column.locator('[data-sidebar-right-guide-entry="files"]').click()
    // Pane borders stay inside the grid width; the shared panel owns no border.
    await expect.poll(() => sidebarSnapshot(page), { timeout: 5_000 })
      .toMatchObject({ mode: 'push', panelContentWidth: normalWidth, panelOuterWidth: normalWidth, resizeHandleWidth: 0 })
    await expect.poll(async () => ({
      filesVisible: await column.locator('[data-files-state="tree"]').isVisible(),
      errors: tripwire.pageErrors,
    })).toEqual({ filesVisible: true, errors: [] })
    await column.locator('[data-dockkit-add-tab]').click()
    await column.locator('[data-sidebar-right-mode="fullscreen"]').click()
    const split = column.locator('[data-dockkit-split-button]').first()
    await expect.poll(() => split.isDisabled()).toBe(false)
    await split.click()
    await expect.poll(() => panes.count()).toBe(2)
    await paneAt(column, 1).locator('[data-sidebar-right-guide-entry="files"]').click()
    await paneAt(column, 0).locator('[data-dockkit-tab]').filter({ hasText: 'Files' }).click()
    await expect.poll(() => paneAt(column, 0).locator('[data-files-state="tree"]').count()).toBe(1)
    const retainedA = await paneSnapshot(page)
    expect(retainedA.map(pane => pane.tabs.map(tab => tab.title))).toEqual([['Files', 'Start'], ['Files']])
    await column.locator('[data-sidebar-right-mode="push"]').click()
    await expect.poll(() => columns(page)).toEqual(normalColumns)
    await checkpoint('A normal: two panes')

    await column.locator('[data-sidebar-right-mode="fullscreen"]').click()
    await expect.poll(() => panel.boundingBox()).toEqual({ x: 0, y: 0, ...viewport })
    expect(await columns(page)).toEqual(normalColumns)
    expect(await sidebarSnapshot(page)).toMatchObject({ mode: 'fullscreen', resizeHandleWidth: 0, coversViewport: true })
    expect(await paneSnapshot(page)).toEqual(retainedA)
    await checkpoint('A manual fullscreen: underlying columns retained')

    // Closing the fullscreen panel exposes Session navigation without changing
    // its manual mode; reopening after the round trip must restore that mode.
    await close()
    expect((await sidebarSnapshot(page)).columnTransition).toBe('none')
    await checkpoint('A closed with manual fullscreen retained')
    await select(seeded, 'DONE')
    await expect.poll(() => detailsTrack(page)).toBe(0)
    await open()
    expect(await panel.getAttribute('data-sidebar-right-panel')).toBe('push')
    await column.locator('[data-sidebar-right-guide-entry="files"]').click()
    await column.locator('[data-files-state="tree"]').waitFor({ timeout: 15_000 })
    const workspaceDirectory = column.locator('[data-files-entry="directory"] > button').filter({ hasText: /^workspace$/ })
    await workspaceDirectory.waitFor({ timeout: 15_000 })
    await workspaceDirectory.click()
    await expect.poll(() => workspaceDirectory.getAttribute('aria-expanded')).toBe('true')
    // The child listing crosses the same Remote as the root listing above.
    await column.locator('[data-files-row="loading"]').waitFor({ state: 'hidden', timeout: 15_000 })
    expect(await column.locator('[data-files-row="failed"]').count()).toBe(0)
    const retainedB = await paneSnapshot(page)
    expect(retainedB.map(pane => pane.tabs.map(tab => tab.title))).toEqual([['Files']])
    await close()
    await checkpoint('B closed: independent pane and expanded workspace directory')

    await select(original, 'LIGHTHOUSE')
    await expect.poll(() => detailsTrack(page)).toBe(0)
    expect(await panel.getAttribute('data-sidebar-right-panel')).toBe('fullscreen')
    expect(await paneSnapshot(page)).toEqual(retainedA)
    await open()
    await expect.poll(() => panel.boundingBox()).toEqual({ x: 0, y: 0, ...viewport })
    expect(await paneSnapshot(page)).toEqual(retainedA)
    await checkpoint('A restored: manual fullscreen, tabs, and panes')
    await column.locator('[data-sidebar-right-mode="push"]').click()
    await expect.poll(async () => (await sidebarSnapshot(page)).panelContentWidth, { timeout: 5_000 }).toBe(normalWidth)

    await select(seeded, 'DONE')
    await expect.poll(() => detailsTrack(page)).toBe(0)
    expect(await panel.getAttribute('data-sidebar-right-panel')).toBe('push')
    expect(await paneSnapshot(page)).toEqual(retainedB)
    await open()
    await expect.poll(() => workspaceDirectory.getAttribute('aria-expanded')).toBe('false')
    expect(await paneSnapshot(page)).toEqual(retainedB)
    await checkpoint('B restored: normal mode and collapsed Files directory')
    await close()
    await select(original, 'LIGHTHOUSE')
    await expect.poll(() => columns(page)).toEqual(normalColumns)
    expect(await column.locator('[data-sidebar-right-open]').count()).toBe(1)
    expect(await paneSnapshot(page)).toEqual(retainedA)
    await checkpoint('A restored: expanded normal panel')

    try {
      for (const width of [1181, 1180, 1024, 767, 390]) {
        await page.setViewportSize({ width, height: viewport.height })
        const track = width > 1180 ? 336 : 0
        await expect.poll(() => columns(page)).toEqual([236, width - 236 - track, track])
        await expect.poll(() => panel.boundingBox()).toEqual({ x: width - 336, y: 0, width: 336, height: viewport.height })
        expect(await panel.getAttribute('data-sidebar-right-panel')).toBe('push')
        expect(await column.locator('[data-sidebar-right-open]').count()).toBe(1)
        expect(await paneSnapshot(page)).toEqual(retainedA)
        expect(await page.locator('[data-side="sidebar"], [data-side="rightbar"]').count()).toBe(0)
        await checkpoint(`A fixed panel at ${width}px`)
        await page.screenshot({ path: join(SHOT_DIR, `fixed-${width}-${MODE}-${process.pid}.png`), fullPage: true })
      }
      await column.locator('[data-sidebar-right-toggle]').click()
      await expect.poll(() => column.locator('[data-sidebar-right-open]').count()).toBe(0)
      await page.setViewportSize(viewport)
      await expect.poll(() => columns(page)).toEqual([236, viewport.width - 236, 0])
      await checkpoint('A closed: widening preserves the closed state')
    } finally {
      await page.setViewportSize(viewport)
    }

    await compareOrRefreshGolden(SIDEBAR_EXPECTED, checkpoints.join('\n\n'), MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['handles.expected.md', 'sidebar.expected.md', 'blank-session.expected.md'])
  })
})
