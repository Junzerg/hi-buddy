/** Center-column top bar: page title, task list, and the right-sidebar toggle. */
import { useState } from 'react'
import {
  IconPanelLeftOutlineRegular, IconQueueOutlineRegular, IconSearchOutlineRegular, Menu, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarKey } from './locales.ts'
import type { SidebarPanelMetadata } from './contract/slots.ts'
import { NAV_PAGE_IDS, placeholderPanelId } from './MorePage.tsx'
import css from './WorkbenchTopbar.module.css'

/** Display name carried by one main-panel registration. */
export interface MainPageTitle {
  readonly key: string
  readonly label: string
}

/** One row in the task menu. */
interface TaskRow {
  readonly id: string
  readonly title: string
}

/** Callbacks the shell closes over its services. Search stays unwired. */
export interface TopbarInjected {
  /** Open one task in the center column. */
  openSession: (sessionId: string) => void
  /** Expand or collapse the right sidebar for the session on screen. */
  toggleRightbar: () => void
  /** Private reactive sources bound to framework selector hooks. */
  hooks: {
    panels: ObservableSnapshot<readonly SidebarPanelMetadata[]>
    /** Archived session ids, hidden from the task menu. */
    archivedSessionIds: ObservableSnapshot<readonly string[]>
    /** Names declared by the main panels currently occupying the center. */
    pageTitles: ObservableSnapshot<readonly MainPageTitle[]>
    /** Shortcut catalog, so the right-sidebar toggle can show its binding. */
    shortcuts: HostObservable<readonly ShortcutCatalogEntry[]>
  }
}

/** Full props: frame owner state, injected actions, and the sidebar locale. */
export type WorkbenchTopbarProps =
  & PropsRuntime<'shell.topbar'>
  & InjectFace<TopbarInjected>
  & PropsLocale<'sidebar'>

/**
 * Title of a non-conversation page, using the same words as its sidebar row.
 * @param panelId - selected main panel.
 * @param panels - registered sidebar panel rows.
 * @param t - sidebar locale seat.
 * @returns the row label, or an empty string when the panel has no row.
 */
function panelTitle(
  panelId: MainPanelId,
  panels: readonly SidebarPanelMetadata[],
  t: (key: SidebarKey) => string,
): string {
  if (panelId === 'schedules') return t('panels.schedules')
  const page = NAV_PAGE_IDS.find(id => placeholderPanelId(id) === panelId)
  if (page !== undefined) return t(`panels.${page}`)
  return panels.find(panel => panel.id === panelId)?.label ?? ''
}

function equalTasks(left: readonly TaskRow[], right: readonly TaskRow[]): boolean {
  return left.length === right.length && left.every((row, index) => {
    const other = right[index]
    return other !== undefined && row.id === other.id && row.title === other.title
  })
}

function equalIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function equalPages(left: readonly MainPageTitle[], right: readonly MainPageTitle[]): boolean {
  return left.length === right.length && left.every((page, index) => {
    const other = right[index]
    return other !== undefined && page.key === other.key && page.label === other.label
  })
}

/**
 * The center column's top bar.
 * Search stays hidden until its action is available.
 * @param props - frame state, task and panel sources, and sidebar copy.
 * @returns the bar.
 */
export function WorkbenchTopbar({
  rightbarShown, usePanelInfo, useSessions, usePanels, useArchivedSessionIds, usePageTitles,
  useShortcuts, openSession, toggleRightbar, t,
}: WorkbenchTopbarProps) {
  const panelId = usePanelInfo(info => info.activePanelId)
  const panels = usePanels(list => list)
  const mainTitle = useSessions((state) => {
    const current = Object.values(state.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)
    return current === undefined || current.blank ? '' : current.displayTitle
  })
  const tasks = useSessions(state => state.ids.flatMap((id) => {
    const row = state.byId[id]
    if (row === undefined || row.blank || row.origin === 'subagent') return []
    return [{ id: row.id, title: row.displayTitle }]
  }), equalTasks)
  const archived = useArchivedSessionIds(ids => ids, equalIds)
  const pages = usePageTitles(list => list, equalPages)
  const toggle = useShortcuts(entries => entries.find(entry => entry.id === 'sidebar.right.toggle'))
  const visibleTasks = tasks.filter(task => !archived.includes(task.id))
  const slotKey = panelId === null ? 'conversation' : panelId
  const slotTitle = pages.find(page => page.key === slotKey)?.label
  const pageTitle = slotKey === 'conversation' && mainTitle !== ''
    ? mainTitle
    : slotTitle !== undefined
      ? slotTitle
      : slotKey === 'conversation'
        ? ''
        : panelTitle(slotKey, panels, t)
  const [tasksOpen, setTasksOpen] = useState(false)
  const rightbarLabel = t(rightbarShown ? 'topbar.collapse' : 'topbar.expand')
  return (
    <header className={css.bar} data-window-drag data-workbench-topbar="">
      <button type="button" className={css.button} data-topbar-search="" hidden>
        <IconSearchOutlineRegular size={14} />
        {t('topbar.search')}
      </button>
      <div className={css.pageTitle}>{pageTitle}</div>
      <div className={css.spacer} />
      <Menu
        open={tasksOpen}
        onClose={() => { setTasksOpen(false) }}
        portal
        align="end"
        listClassName={css.taskMenu}
        items={visibleTasks.length === 0
          ? [{ id: 'empty', label: t('topbar.tasksEmpty'), disabled: true }]
          : visibleTasks.map(task => ({ id: task.id, label: task.title }))}
        onSelect={(id) => {
          setTasksOpen(false)
          if (id === 'empty') return
          openSession(id)
        }}
        anchor={(
          <button type="button" className={css.button} aria-expanded={tasksOpen} aria-haspopup="menu"
            onClick={() => { setTasksOpen(open => !open) }}>
            <IconQueueOutlineRegular size={14} />
            {t('topbar.tasks')}
          </button>
        )}
      />
      <Tooltip label={rightbarLabel} shortcutKeys={toggle?.keys} side="bottom" delayMs={500}>
        <button
          type="button"
          className={css.button}
          aria-keyshortcuts={toggle?.aria}
          data-sidebar-right-expand={rightbarShown ? undefined : ''}
          onClick={toggleRightbar}
        >
          <IconPanelLeftOutlineRegular className={css.expandIcon} size={14} />
          {rightbarLabel}
        </button>
      </Tooltip>
    </header>
  )
}
