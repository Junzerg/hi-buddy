/** Registers the sidebar shell and global panel navigation. */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session root standard-props merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarPanelMetadata, SidebarRootInjected } from './contract/slots.ts'
import { createPanelPins } from './panel-pins.ts'
import { PlaceholderPage, NAV_PAGE_IDS, placeholderPanelId, type PlaceholderInjected } from './MorePage.tsx'
import { SidebarRoot } from './SidebarRoot.tsx'
import { ConversationNavigation, WorkbenchTopbar, type MainPageTitle, type TopbarInjected } from './WorkbenchTopbar.tsx'
import { en, zh, type SidebarKey } from './locales.ts'

export type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps, SidebarFooterActionOwnerProps,
  SidebarPanelActionEntry, SidebarPanelActionsOwnerProps, SidebarPanelIconOwnerProps, SidebarPanelMetadata,
  SidebarRootComponentProps, SidebarRootInjected, SidebarSectionOwnerProps, SidebarSettingsOwnerProps,
} from './contract/slots.ts'
export type { SidebarKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Sidebar controls and global panel copy. */
    sidebar: SidebarKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'sidebar'

interface WorkspaceNavigation {
  startSession(workspaceId?: Parameters<SidebarRootInjected['startSession']>[0]): void
  openSession(sessionId: string): void
}

/** The right sidebar's toggle, read optionally so this shell does not wait on that plugin. */
interface RightbarToggle {
  /** On-screen session target. `null` asks for that session, ignoring the focused element. */
  commandTarget(element: null): unknown
  toggleExpanded(): void
}

/** Services required by the sidebar plugin. */
export const inject = ['slots', 'layout', 'uiWorkspace', 'locale', 'shortcuts']

/** Registers the sidebar shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar: dictionaries')
  const t = ctx.locale.bind(NS)
  const panels = createSnapshotStore<readonly SidebarPanelMetadata[]>([])
  const syncPanels = (): void => {
    const next = ctx.slots.entriesOfSlot('sidebar.panellist').map(({ options }) => {
      // The list registration requires an id; StoredEntry erases the slot kind.
      const id = options.id as MainPanelId
      return { id, order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? id }
    }).sort((a, b) => a.order - b.order)
    const previous = panels.getSnapshot()
    if (previous.length === next.length && previous.every((panel, index) => {
      const candidate = next[index] as SidebarPanelMetadata
      return panel.id === candidate.id && panel.order === candidate.order && panel.label === candidate.label
    })) return
    panels.set(next)
  }
  ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', syncPanels), 'ui-sidebar: panel entries')
  ctx.effect(() => ctx.locale.subscribe(syncPanels), 'ui-sidebar: panel labels')
  const pageTitles = createSnapshotStore<readonly MainPageTitle[]>([])
  const syncPageTitles = (): void => {
    const next = ctx.slots.entriesOfSlot('main').flatMap((entry) => {
      const key = entry.options.key
      const label = resolveSlotLabel(entry.options.label)
      if (key === undefined || label === undefined || label === '') return []
      return [{ key, label }]
    })
    const previous = pageTitles.getSnapshot()
    if (previous.length === next.length && previous.every((page, index) => {
      const candidate = next[index]
      return candidate !== undefined && page.key === candidate.key && page.label === candidate.label
    })) return
    pageTitles.set(next)
  }
  ctx.effect(() => ctx.slots.subscribe('main', syncPageTitles), 'ui-sidebar: page titles')
  ctx.effect(() => ctx.locale.subscribe(syncPageTitles), 'ui-sidebar: page title labels')
  const panelPins = createPanelPins()
  const entryActions = {
    getSnapshot: () => ctx.slots.entriesOfSlot('sidebar.panellist.actions').length > 0,
    subscribe: (listener: () => void) => ctx.slots.subscribe('sidebar.panellist.actions', listener),
  }

  const injectProps = (): SidebarRootInjected => ({
    // The shell's New Session button rides the Workspace UI's shared action
    // (current Session Workspace, then recent Workspace).
    startSession: (workspaceId) => { workspaceNavigation.startSession(workspaceId) },
    selectPanel: (id) => { ctx.layout.selectPanel(id) },
    setPinned: panelPins.setPinned,
    trackEntryClick: (attributes) => { ctx.get('productAnalytics')?.track('sidebar_menu_click', attributes) },
    hooks: { panels, shortcuts: ctx.shortcuts.catalog, entryPins: panelPins.unpinned, entryActions },
  })
  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar',
    locale: NS,
    children: {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'sidebar.panellist.actions': { kind: 'list', scope: 'root' },
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
      'sidebar.settings': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
    inject: injectProps,
  }, SidebarRoot))
  for (const page of NAV_PAGE_IDS) {
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main', key: placeholderPanelId(page), locale: NS,
      label: () => t(`panels.${page}`),
      inject: (): PlaceholderInjected => ({ page }),
    }, PlaceholderPage))
  }
  const archivedSessionIds = createSnapshotStore<readonly string[]>([])
  ctx.effect(() => {
    const workspaces = ctx.get('workspaces')
    if (workspaces === undefined) return () => {}
    const publish = (): void => {
      const next = workspaces.list.getSnapshot().archivedSessionIds
      const previous = archivedSessionIds.getSnapshot()
      if (previous.length === next.length && previous.every((id, index) => id === next[index])) return
      archivedSessionIds.set(next)
    }
    publish()
    return workspaces.list.subscribe(publish)
  }, 'ui-sidebar: archived sessions')
  const topbarInject = (): TopbarInjected => ({
    openSession: (sessionId) => { workspaceNavigation.openSession(sessionId) },
    toggleRightbar: () => {
      const sidebar = ctx.get('sidebarRight') as RightbarToggle | undefined
      // The click focuses this button, so null asks whether a session is on screen.
      if (sidebar === undefined || sidebar.commandTarget(null) === undefined) return
      sidebar.toggleExpanded()
    },
    hooks: { panels, archivedSessionIds, pageTitles, shortcuts: ctx.shortcuts.catalog },
  })
  ctx.slots.inject('shell.topbar', () => ctx.slots.register({
    name: 'shell.topbar',
    locale: NS,
    inject: topbarInject,
  }, WorkbenchTopbar))
  ctx.slots.inject('conversation.header.navigation', () => ctx.slots.register({
    name: 'conversation.header.navigation',
    locale: NS,
    inject: topbarInject,
  }, ConversationNavigation))
  syncPanels()
  syncPageTitles()
}
