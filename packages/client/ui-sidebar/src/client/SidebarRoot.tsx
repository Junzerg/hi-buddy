/**
 * Sidebar shell: column geometry and global panel navigation.
 * The fixed navigation column contains the brand, New Session, global panels,
 * the workspace browser, and the bottom settings and footer actions.
 *
 * The column also owns whether the scroll regions nested in it draw a
 * scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
 * scrollbar indirection away while it is elsewhere, so a list the user is not
 * pointing at carries no bar.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  BrandLogo,
  isDarwinDesktop, ShortcutKeys, Toast, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SidebarPanelMetadata, SidebarRootComponentProps, SidebarRootInjected,
} from './contract/slots.ts'
import { NAV_PAGE_IDS, placeholderPanelId, PlaceholderIcon } from './MorePage.tsx'
import css from './SidebarRoot.module.css'

const SIDEBAR_PANEL_ALLOWLIST: readonly string[] = [
  'schedules',
  'project-glossary',
]

/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2000

/** Format complete-build metadata for the local brand badge. */
function localBuildVersion(): string | undefined {
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined) return undefined
  const commit = process.env.DSH_CLIENT_COMMIT_HASH
  return version
    + (commit === undefined ? '' : `-${commit}`)
    + (process.env.DSH_CLIENT_GIT_DIRTY === 'true' ? '-dirty' : '')
}

type PanelRowProps =
  Pick<SidebarPanelMetadata, 'id' | 'label'>
  & Pick<PropsRuntime<'sidebar'>, 'usePanelInfo'>
  & Pick<InjectFace<SidebarRootInjected>, 'selectPanel' | 'trackEntryClick'>
  & PropsRenderSlots<'sidebar.panellist'>

/** Analytics category of an official panel; other panels are never reported. */
function officialEntry(id: string): 'plugin' | 'cron' | undefined {
  if (id === 'plugins') return 'plugin'
  return id === 'schedules' ? 'cron' : undefined
}

/** Each panel row subscribes only to its own selection state. */
function PanelRow({ id, label, usePanelInfo, selectPanel, trackEntryClick, renderSlot }: PanelRowProps) {
  const active = usePanelInfo(info => info.activePanelId === id)
  return (
    <button
      type="button"
      className={clsx(css.panelRow, active && css.panelActive)}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        const entry = officialEntry(id)
        if (entry !== undefined) trackEntryClick({ menu_name: entry, position: 'sidebar' })
        selectPanel(id)
      }}
    >
      <span className={css.panelGlyph} aria-hidden="true">
        {id === 'schedules' ? <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2" />
        </svg> : renderSlot('sidebar.panellist', { size: 17, active }, { only: id })}
      </span>
      <span className={clsx(css.panelTitle, css.wide)}>
        {label}
      </span>
    </button>
  )
}

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  width,
  startSession,
  selectPanel,
  trackEntryClick,
  useRemoteAccess,
  usePanels,
  useShortcuts,
  usePanelInfo,
  t,
  renderSlot,
}: SidebarRootComponentProps) {
  const panels = usePanels(snapshot => snapshot)
  const activePanelId = usePanelInfo(info => info.activePanelId)
  const newShortcut = useShortcuts(rows => rows.find(row => row.id === 'session.new'))
  // A page whose access snapshot excludes starting a Session offers no New Session affordance.
  const canStartSession = useRemoteAccess('session/create')
  const openNewSession = (): void => {
    trackEntryClick({ menu_name: 'new_session', position: 'sidebar' })
    startSession()
  }

  // Scrollbars in the column follow the pointer (.quietBars rebinds them
  // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
  // leaves. A pointer that returns within that window cancels the pending
  // hide rather than restarting from a hidden bar.
  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  // Leaving is decided by the column's BOX, not by DOM containment, and only
  // while the bars are drawn. ui-settings renders its full-viewport panel as a
  // fixed-position DESCENDANT of this column, so a pointer moved onto that
  // panel — or onto the conversation once it closes — fires no `pointerleave`
  // here, and the bars would stay drawn over a column nobody is pointing at.
  // The element's own leave stays as the one signal geometry cannot give: a
  // pointer that leaves the window emits no further moves.
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  const buildVersion = localBuildVersion()
  // The local-build fallbacks copy the badge text; the brand button below
  // skips New Session for clicks inside them. The click still bubbles, so
  // document-level outside-click listeners see it.
  // Each successful copy bumps the key so a repeated copy replays the toast.
  const [copiedToast, setCopiedToast] = useState<number | null>(null)
  const copyVersion = (version: string) => (): void => {
    void writeClipboard(version).then((ok) => {
      if (ok) setCopiedToast(seq => (seq ?? 0) + 1)
    })
  }

  const darwinDesktop = isDarwinDesktop()
  return (
    <div
      ref={column}
      className={clsx(css.root, !pointerInside && css.quietBars)}
      style={{ width }}
      onPointerEnter={() => {
        cancelLinger()
        setPointerInside(true)
      }}
      onPointerLeave={() => { armLinger() }}
    >
      {/* macOS hiddenInset titlebar: reserve the native traffic-light strip. */}
      {darwinDesktop && <div className={css.topStrip} data-window-drag />}
      <div className={css.logoRow} data-window-drag>
        {/* The brand doubles as a New Session shortcut while the
            access snapshot allows `session/create` — except on
            macOS, where it stays part of the logo row's window-drag surface
            (a button would subtract itself through the global no-drag rule);
            Mouse clicks on the local-build fallbacks copy the version instead. */}
        {(() => {
          const identity = (
            <span className={css.brandIdentity} aria-hidden="true">
              <span className={css.brandMark}>
                {renderSlot('sidebar.brand.mark', { size: 24 }, {
                  fallback: buildVersion === undefined
                    ? <BrandLogo size={24} />
                    : (
                      <span className={css.copyVersion} data-copy-version onClick={copyVersion(buildVersion)}>
                        <BrandLogo size={24} />
                      </span>
                    ),
                })}
              </span>
              <span className={css.brandText}>
                <span className={css.brandName}>
                  {renderSlot('sidebar.brand.name', {}, {
                    fallback: buildVersion === undefined
                      ? <span className={css.fallbackBrandName}>{t('brand.localBuild')}</span>
                      : (
                        <span className={clsx(css.localBuildBrand, css.copyVersion)} data-copy-version onClick={copyVersion(buildVersion)}>
                          <span className={css.localBuildTitle}>{t('brand.localBuild')}</span>
                        </span>
                      ),
                  })}
                </span>
                {buildVersion !== undefined && (
                  <span className={clsx(css.buildVersion, css.copyVersion)} data-copy-version
                    title={buildVersion} onClick={copyVersion(buildVersion)}>{process.env.DSH_CLIENT_VERSION}</span>
                )}
              </span>
            </span>
          )
          return darwinDesktop || !canStartSession
            ? <span className={clsx(css.brand, css.wide)}>{identity}</span>
            : (
              <button
                type="button"
                className={clsx(css.brand, css.wide)}
                aria-label={t('session.new.label')}
                aria-keyshortcuts={newShortcut?.aria}
                onClick={(event) => {
                  if ((event.target as Element).closest('[data-copy-version]') !== null) return
                  openNewSession()
                }}
              >
                {identity}
              </button>
            )
        })()}
      </div>

      {/* The label fades before the hover/focus shortcut, including on translucent backgrounds. */}
      {canStartSession && (
        <button
          type="button"
          className={css.newSession}
          aria-label={t('session.new.label')}
          aria-keyshortcuts={newShortcut?.aria}
          onClick={openNewSession}
        >
          <span className={css.newSessionLabelMask}><span className={css.newSessionContent}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className={clsx(css.newSessionLabel, css.wide)}>{t('session.new')}</span>
          </span></span>
          {newShortcut !== undefined && newShortcut.keys.length > 0 && <span className={css.newSessionShortcut} aria-hidden="true">
            <ShortcutKeys keys={newShortcut.keys} />
          </span>}
        </button>
      )}

      <nav className={css.panelList} aria-label={t('panels.label')}>
        {NAV_PAGE_IDS.flatMap((page) => {
          const id = placeholderPanelId(page)
          const entry = <button key={page} type="button" hidden
            className={clsx(css.panelRow, activePanelId === id && css.panelActive)}
            aria-label={t(`panels.${page}`)} aria-current={activePanelId === id ? 'page' : undefined}
            onClick={() => {
              if (page === 'more') trackEntryClick({ menu_name: 'more', position: 'sidebar' })
              selectPanel(id)
            }}>
            <span className={css.panelGlyph}><PlaceholderIcon page={page} /></span>
            <span className={clsx(css.panelTitle, css.wide)}>{t(`panels.${page}`)}</span>
            {page === 'assistant' && <span className={css.betaTag}>{t('panels.beta')}</span>}
          </button>
          if (page !== 'experts') return [entry]
          return [entry, ...panels.filter(({ id: panelId }) => SIDEBAR_PANEL_ALLOWLIST.includes(panelId)).map(({ id: panelId, label }) => (
            <PanelRow key={panelId} id={panelId} label={panelId === 'schedules' ? t('panels.schedules') : label}
              usePanelInfo={usePanelInfo} selectPanel={selectPanel}
              trackEntryClick={trackEntryClick} renderSlot={renderSlot} />
          ))]
        })}
      </nav>

      {/* The browsing region fills the column between the controls and the
          foot of the fixed navigation column. */}
      <div className={css.regionArea}>
        {renderSlot('sidebar.workspaces', {
          wide: true,
          expandSidebar: () => undefined,
        })}
      </div>

      {copiedToast !== null && (
        <Toast key={copiedToast} tone="success" text={t('version.copied')} onDone={() => { setCopiedToast(null) }} />
      )}

      {/* Footer actions stack above Settings. */}
      <div className={css.footArea}>
        <div className={css.footerActions}>
          {renderSlot('sidebar.footer.action', { wide: true })}
        </div>
        <div className={css.settingsArea}>
          {renderSlot('sidebar.settings', { wide: true })}
        </div>
      </div>
    </div>
  )
}
