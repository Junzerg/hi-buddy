// @vitest-environment jsdom
/** Center-column top bar: page title, task list, and the right-sidebar toggle. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationNavigation, WorkbenchTopbar } from '../src/client/WorkbenchTopbar.tsx'
import type { ConversationNavigationProps, WorkbenchTopbarProps } from '../src/client/WorkbenchTopbar.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

interface Row {
  id: string
  title: string
  blank?: boolean
  archived?: boolean
  subagent?: boolean
  main?: boolean
}

function mount(overrides: {
  panelId?: string | null
  rightbarShown?: boolean
  sessions?: readonly Row[]
  panels?: readonly { id: string; label: string }[]
  pages?: readonly { key: string; label: string }[]
} = {}) {
  const openSession = vi.fn()
  const toggleRightbar = vi.fn()
  const sessions = overrides.sessions ?? []
  const byId: Record<string, object> = {}
  for (const row of sessions) {
    byId[row.id] = {
      id: row.id,
      displayTitle: row.title,
      blank: row.blank ?? false,
      origin: row.subagent === true ? 'subagent' : undefined,
      retainedBy: row.main === true ? { mainView: 1 } : {},
      running: false,
      updatedAt: 0,
    }
  }
  const props = {
    rightbarShown: overrides.rightbarShown ?? false,
    useRightbarShown: (select: (shown: boolean) => unknown) => select(overrides.rightbarShown ?? false),
    usePanelInfo: (select: (info: { activePanelId: string | null }) => unknown) => (
      select({ activePanelId: overrides.panelId ?? null })
    ),
    useSessions: (select: (state: { ids: string[]; byId: typeof byId }) => unknown) => (
      select({ ids: sessions.map(row => row.id), byId })
    ),
    useArchivedSessionIds: (select: (ids: readonly string[]) => unknown) => (
      select(sessions.filter(row => row.archived === true).map(row => row.id))
    ),
    usePanels: (select: (list: { id: string; order: number; label: string }[]) => unknown) => (
      select((overrides.panels ?? []).map((panel, order) => ({ ...panel, order })))
    ),
    usePageTitles: (select: (pages: readonly { key: string; label: string }[]) => unknown) => (
      select(overrides.pages ?? [])
    ),
    useShortcuts: (select: (entries: readonly { id: string }[]) => unknown) => select([]),
    openSession,
    toggleRightbar,
    t: (key: keyof typeof zh) => zh[key],
  } as unknown as WorkbenchTopbarProps
  if (overrides.panelId === undefined) render(<ConversationNavigation {...props as unknown as ConversationNavigationProps} />)
  else render(<WorkbenchTopbar {...props} />)
  return { openSession, toggleRightbar }
}

describe('WorkbenchTopbar', () => {
  it('names independent pages and leaves the conversation title to its resident header', () => {
    mount({ panelId: null, pages: [{ key: 'conversation', label: '新建任务' }] })
    expect(screen.queryByText('新建任务')).toBeNull()
    expect(document.querySelector('[data-workbench-topbar]')).toBeNull()
    cleanup()

    mount({ panelId: 'sidebar-assistant', pages: [{ key: 'sidebar-assistant', label: '远程助理' }] })
    expect(screen.getByText('远程助理')).toBeTruthy()
    cleanup()

    mount({ panelId: 'schedules' })
    expect(screen.getByText('定时任务')).toBeTruthy()
    cleanup()

    mount({ panelId: 'plugins', panels: [{ id: 'plugins', label: '插件' }] })
    expect(screen.getByText('插件')).toBeTruthy()
    cleanup()

    mount({
      panelId: 'conversation',
      pages: [{ key: 'conversation', label: '新建任务' }],
      sessions: [{ id: 'task-1', title: '季度报告', main: true }],
    })
    expect(screen.queryByText('季度报告')).toBeNull()
  })

  it('hides unfinished search and toggles the right sidebar', () => {
    const { openSession, toggleRightbar } = mount()
    expect(screen.queryByRole('button', { name: '搜索' })).toBeNull()
    expect(openSession).not.toHaveBeenCalled()
    expect(toggleRightbar).not.toHaveBeenCalled()
    const expand = screen.getByRole('button', { name: '展开侧栏' })
    expect(expand.hasAttribute('data-sidebar-right-expand')).toBe(true)
    fireEvent.click(expand)
    expect(toggleRightbar).toHaveBeenCalledOnce()
    cleanup()

    const collapsed = mount({ rightbarShown: true })
    const collapse = screen.getByRole('button', { name: '收起侧栏' })
    expect(collapse.hasAttribute('data-sidebar-right-expand')).toBe(false)
    fireEvent.click(collapse)
    expect(collapsed.toggleRightbar).toHaveBeenCalledOnce()
  })

  it('opens a listed task and skips blanks, subagents, and archived rows', () => {
    const { openSession } = mount({
      sessions: [
        { id: 'blank', title: '新的', blank: true },
        { id: 'child', title: '子任务', subagent: true },
        { id: 'old', title: '已归档', archived: true },
        { id: 'live', title: '季度报告' },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: '任务概览' }))
    expect(screen.queryByRole('menuitem', { name: '新的' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '子任务' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '已归档' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '季度报告' }))
    expect(openSession).toHaveBeenCalledExactlyOnceWith('live')
  })

  it('says when the task list is empty', () => {
    const { openSession } = mount()
    fireEvent.click(screen.getByRole('button', { name: '任务概览' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '还没有任务' }))
    expect(openSession).not.toHaveBeenCalled()
  })
})
