/** Global page titles and shared task navigation for the workbench and conversation header. */
import { useState } from 'react'
import {
  IconPanelLeftOutlineRegular, IconQueueOutlineRegular, Menu, Tooltip,
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

/** Callbacks and reactive sources shared by the navigation surfaces. */
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

/** Frame owner state, injected actions, and the sidebar locale. */
export type WorkbenchTopbarProps =
  & PropsRuntime<'shell.topbar'>
  & InjectFace<TopbarInjected>
  & PropsLocale<'sidebar'>

/** Root-scoped navigation stays available before a Session exists. */
export type ConversationNavigationProps =
  & PropsRuntime<'conversation.header.navigation'>
  & InjectFace<TopbarInjected>
  & PropsLocale<'sidebar'>

type WorkbenchActionsProps = Pick<WorkbenchTopbarProps,
  'rightbarShown' | 'useSessions' | 'useArchivedSessionIds' | 'useShortcuts'
  | 'openSession' | 'toggleRightbar' | 't'>

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

/** Render shared task navigation and the right-sidebar toggle. */
function WorkbenchActions({
  rightbarShown, useSessions, useArchivedSessionIds, useShortcuts, openSession, toggleRightbar, t,
}: WorkbenchActionsProps) {
  const tasks = useSessions(state => state.ids.flatMap((id) => {
    const row = state.byId[id]
    if (row === undefined || row.blank || row.origin === 'subagent') return []
    return [{ id: row.id, title: row.displayTitle }]
  }), equalTasks)
  const archived = useArchivedSessionIds(ids => ids, equalIds)
  const toggle = useShortcuts(entries => entries.find(entry => entry.id === 'sidebar.right.toggle'))
  const visibleTasks = tasks.filter(task => !archived.includes(task.id))
  const [tasksOpen, setTasksOpen] = useState(false)
  const rightbarLabel = t(rightbarShown ? 'topbar.collapse' : 'topbar.expand')
  return (
    <div className={css.actions}>
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
          <Tooltip label={t('topbar.tasks')} side="bottom" delayMs={500}>
            <button type="button" className={css.button} aria-label={t('topbar.tasks')} aria-expanded={tasksOpen} aria-haspopup="menu"
              onClick={() => { setTasksOpen(open => !open) }}>
              <IconQueueOutlineRegular size={14} />
              <span className={css.buttonLabel}>{t('topbar.tasks')}</span>
            </button>
          </Tooltip>
        )}
      />
      <Tooltip label={rightbarLabel} shortcutKeys={toggle?.keys} side="bottom" delayMs={500}>
        <button
          type="button"
          className={css.button}
          aria-label={rightbarLabel}
          aria-keyshortcuts={toggle?.aria}
          data-sidebar-right-expand={rightbarShown ? undefined : ''}
          onClick={toggleRightbar}
        >
          <IconPanelLeftOutlineRegular className={css.expandIcon} size={14} />
          <span className={css.buttonLabel}>{rightbarLabel}</span>
        </button>
      </Tooltip>
    </div>
  )
}

/** Render task navigation in the resident Conversation header. */
export function ConversationNavigation(props: ConversationNavigationProps) {
  const rightbarShown = props.useRightbarShown(shown => shown)
  return <WorkbenchActions {...props} rightbarShown={rightbarShown} />
}

/** Render the workbench top bar for independent global pages. */
export function WorkbenchTopbar(props: WorkbenchTopbarProps) {
  const panelId = props.usePanelInfo(info => info.activePanelId)
  const panels = props.usePanels(list => list)
  const pages = props.usePageTitles(list => list, equalPages)
  if (panelId === null || panelId === 'conversation') return null
  const pageTitle = pages.find(page => page.key === panelId)?.label ?? panelTitle(panelId, panels, props.t)
  return (
    <header className={css.bar} data-window-drag data-workbench-topbar="">
      <div className={css.pageTitle}>{pageTitle}</div>
      <div className={css.spacer} />
      <WorkbenchActions {...props} />
    </header>
  )
}
