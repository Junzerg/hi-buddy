/** Fixed navigation and a resizable right panel around the flexible main column. */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { IconPanelLeftOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { clampRightbarWidth, computeColumns, rightbarBounds, SIDEBAR_DEFAULT } from './columns.ts'
import { RightbarResizeHandle } from './RightbarResizeHandle.tsx'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'main' | 'rightbar' | 'shell.bottom' | 'shell.topbar' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'layout'>

/** Center column: the top bar, then the panel that fills the rest of the column. */
function CenterColumn(props: { topbar?: ReactNode; children?: ReactNode }) {
  return (
    <div className={css.centerCol}>
      {props.topbar}
      <div className={css.centerBody}>{props.children}</div>
    </div>
  )
}

/** Subscribe to the main key without subscribing the column frame to each panel id. */
function MainPanel({ usePanelInfo, renderSlot }: Pick<PropsRuntime<'root'>, 'usePanelInfo'> & PropsRenderSlots<'main'>) {
  const panelId = usePanelInfo(info => info.activePanelId)
  return renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })
}

/**
 * Right column grid item. Zero-width unless the occupant asked for a track; the
 * occupant's panel is positioned against the column's right edge, which never
 * moves, so it can hang over the centre when there is no track.
 */
function RightbarColumn(props: { children?: ReactNode }) {
  return <div className={css.rightbarCol} data-rightbar-col>{props.children}</div>
}

/** The main column keeps its width when the right panel overlays it. */
export function AppFrame({
  useStore, useSessions, usePanelInfo, actions, renderSlot, t,
}: AppFrameProps) {
  const layoutInfo = useStore(state => state.layoutInfo)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const viewport = layoutInfo.viewportWidth

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useLayoutEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    let disposed = false
    const measure = () => {
      const width = el.getBoundingClientRect().width
      if (width > 0) actions.setViewportWidth(width)
    }
    measure()
    const observer = new ResizeObserver(() => {
      if (disposed) return
      raf ??= requestAnimationFrame(() => {
        raf = null
        measure()
      })
    })
    observer.observe(el)
    return () => {
      disposed = true
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [actions])

  const windowsTitlebar = document.documentElement.hasAttribute('data-windows-titlebar')
  const sidebarWidth = sidebarCollapsed ? 0 : SIDEBAR_DEFAULT
  const bounds = rightbarBounds(viewport, sidebarWidth)
  const rightbarWidth = clampRightbarWidth(layoutInfo.rightbarWidth, bounds)
  const cols = computeColumns(viewport, layoutInfo.rightbarTrack, rightbarWidth)
  const toggleLabel = t(sidebarCollapsed ? 'sidebar.expand' : 'sidebar.collapse')
  const sidebar = useMemo(() => renderSlot('sidebar', {
    collapsed: false, width: 236, drawer: false,
  }), [renderSlot])
  const main = useMemo(() => (
    <MainPanel usePanelInfo={usePanelInfo} renderSlot={renderSlot} />
  ), [usePanelInfo, renderSlot])
  const topbar = useMemo(() => renderSlot('shell.topbar', {
    rightbarShown: layoutInfo.rightbarShown,
  }), [renderSlot, layoutInfo.rightbarShown])
  const overlays = useMemo(() => renderSlot('shell.overlay', {}), [renderSlot])

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        '--dsh-sidebar-track-width': `${sidebarWidth}px`,
        ...(windowsTitlebar ? { '--dsh-windows-sidebar-width': `${sidebarWidth}px` } : {}),
        '--dsh-rightbar-track-width': `${layoutInfo.rightbarTrack ? rightbarWidth : 0}px`,
        '--dsh-rightbar-panel-width': `${rightbarWidth}px`,
      } as CSSProperties}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-rightbar-collapsed={cols.rightbar === 0 || undefined}
      data-rightbar-open={layoutInfo.rightbarShown || undefined}
      data-rightbar-fullscreen={layoutInfo.rightbarFullscreen || undefined}
      data-rightbar-instant={layoutInfo.rightbarInstant || undefined}
    >
      <DocumentTitle
        productTitle={process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')}
        useSessions={useSessions}
        usePanelInfo={usePanelInfo}
      />
      <div className={css.sidebarCol} aria-hidden={sidebarCollapsed || undefined}>{sidebar}</div>
      <CenterColumn topbar={topbar}>{main}</CenterColumn>
      <RightbarColumn>
        {renderSlot('rightbar', { width: rightbarWidth, viewportWidth: viewport, canShow: true })}
        {layoutInfo.rightbarShown && !layoutInfo.rightbarFullscreen && (
          <RightbarResizeHandle width={rightbarWidth} bounds={bounds} label={t('rightbar.resize')}
            onResize={actions.setRightbarWidth} />
        )}
      </RightbarColumn>
      <div className={css.bottomRow} data-shell-bottom>{renderSlot('shell.bottom', {})}</div>
      <div className={css.overlayLayer} data-shell-overlay>{overlays}</div>
      <Tooltip label={toggleLabel} side="bottom" delayMs={500}>
        <button type="button" className={css.sidebarToggle} aria-label={toggleLabel}
          aria-expanded={!sidebarCollapsed} onClick={() => { setSidebarCollapsed(value => !value) }}>
          <IconPanelLeftOutlineRegular size={16} />
        </button>
      </Tooltip>
    </div>
  )
}
